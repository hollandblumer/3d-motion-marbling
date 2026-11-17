"""Train and export a small landmark-to-MANO browser inference model.

The runtime model accepts MediaPipe-style normalized landmarks plus handedness
and returns all 778 MANO vertices in the same root/scale-normalized coordinate
space. It replaces the per-frame Adam loop used by ``main.py`` with one forward
pass that ONNX Runtime Web can execute on WebGPU or WASM.
"""

from __future__ import annotations

import argparse
import inspect
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "models"
DEFAULT_OUTPUT = ROOT / "public" / "3d-motion-marbling" / "mano-landmark-regressor.onnx"


def patch_legacy_numpy() -> None:
    if not hasattr(inspect, "getargspec"):
        inspect.getargspec = inspect.getfullargspec
    for alias, value in {
        "bool": bool,
        "int": int,
        "float": float,
        "complex": complex,
        "object": object,
        "str": str,
        "unicode": str,
    }.items():
        if alias not in np.__dict__:
            setattr(np, alias, value)


def normalize_surface(vertices: torch.Tensor, joints: torch.Tensor):
    root = joints[:, :1]
    scale = (joints - root).norm(dim=2).mean(dim=1, keepdim=True).clamp_min(1e-8)
    return (joints - root) / scale.unsqueeze(-1), (vertices - root) / scale.unsqueeze(-1)


class ManoLandmarkRegressor(nn.Module):
    def __init__(self, vertex_count: int = 778):
        super().__init__()
        self.vertex_count = vertex_count
        self.network = nn.Sequential(
            nn.Linear(64, 256),
            nn.GELU(),
            nn.Linear(256, 384),
            nn.GELU(),
            nn.Linear(384, 384),
            nn.GELU(),
            nn.Linear(384, vertex_count * 3),
        )

    def forward(self, landmarks: torch.Tensor, handedness: torch.Tensor):
        x = torch.cat((landmarks.reshape(landmarks.shape[0], 63), handedness), dim=1)
        return self.network(x).reshape(-1, self.vertex_count, 3)


@torch.no_grad()
def make_batch(layers, batch_size: int, device: torch.device):
    side_ids = torch.randint(0, 2, (batch_size,), device=device)
    input_joints = torch.empty(batch_size, 21, 3, device=device)
    target_vertices = torch.empty(batch_size, 778, 3, device=device)

    for side_id, layer in enumerate(layers):
        indices = torch.where(side_ids == side_id)[0]
        if not len(indices):
            continue
        count = len(indices)
        pose = torch.randn(count, 48, device=device)
        pose[:, :3] *= 0.9
        pose[:, 3:] *= 0.62
        # Include almost-flat poses so the network remains stable when a hand
        # first enters the camera and MediaPipe has not accumulated depth yet.
        flat = torch.rand(count, device=device) < 0.12
        pose[flat, 3:] *= 0.08
        shape = torch.randn(count, 10, device=device) * 0.7
        vertices, joints = layer(pose, shape)
        joints, vertices = normalize_surface(vertices, joints[:, :21])
        # Mild detector noise prevents the regressor from depending on perfect
        # synthetic joint geometry.
        joints += torch.randn_like(joints) * 0.006
        input_joints[indices] = joints
        target_vertices[indices] = vertices

    handedness = side_ids.float().unsqueeze(1)
    return input_joints, handedness, target_vertices


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--steps", type=int, default=1800)
    parser.add_argument("--batch-size", type=int, default=96)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    patch_legacy_numpy()
    from manopth.manolayer import ManoLayer

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    layers = [
        ManoLayer(
            mano_root=str(args.model_dir),
            use_pca=True,
            ncomps=45,
            flat_hand_mean=False,
            side=side,
        ).to(device)
        for side in ("left", "right")
    ]
    for layer in layers:
        layer.eval()

    model = ManoLandmarkRegressor().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1.5e-3, weight_decay=2e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, args.steps, eta_min=8e-5)

    model.train()
    for step in range(1, args.steps + 1):
        landmarks, handedness, target = make_batch(layers, args.batch_size, device)
        prediction = model(landmarks, handedness)
        vertex_loss = (prediction - target).abs().mean()
        tip_loss = (prediction[:, [745, 317, 445, 556, 673]] - target[:, [745, 317, 445, 556, 673]]).abs().mean()
        loss = vertex_loss + tip_loss * 1.8
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        scheduler.step()
        if step == 1 or step % 100 == 0:
            print(f"step={step:04d} loss={loss.item():.6f}", flush=True)

    model = model.cpu().eval()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    dummy_landmarks = torch.zeros(1, 21, 3)
    dummy_handedness = torch.zeros(1, 1)
    torch.onnx.export(
        model,
        (dummy_landmarks, dummy_handedness),
        str(args.output),
        input_names=["landmarks", "handedness"],
        output_names=["vertices"],
        dynamic_axes={"landmarks": {0: "batch"}, "handedness": {0: "batch"}, "vertices": {0: "batch"}},
        opset_version=18,
        do_constant_folding=True,
    )

    import onnx
    import onnxruntime as ort

    graph = onnx.load(str(args.output))
    onnx.checker.check_model(graph)
    # Recent PyTorch exporters split weights into a sibling `.data` file. A
    # single model file is easier and more reliable for browsers/CDNs.
    onnx.save_model(graph, str(args.output), save_as_external_data=False)
    external_data = Path(f"{args.output}.data")
    if external_data.exists():
        external_data.unlink()
    session = ort.InferenceSession(str(args.output), providers=["CPUExecutionProvider"])
    test_landmarks, test_handedness, target = make_batch(layers, 8, torch.device("cpu"))
    output = session.run(
        ["vertices"],
        {
            "landmarks": test_landmarks.numpy().astype(np.float32),
            "handedness": test_handedness.numpy().astype(np.float32),
        },
    )[0]
    mae = np.abs(output - target.numpy()).mean()
    print(f"wrote={args.output} bytes={args.output.stat().st_size} validation_mae={mae:.6f}")


if __name__ == "__main__":
    main()
