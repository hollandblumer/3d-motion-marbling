export const metadata = {
  title: "3D Motion Marbling | Holland Blumer",
  description:
    "A webcam-driven MANO hand experiment for pulling color through a digital marbling bath.",
};

export default function ThreeDMotionMarblingPage() {
  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-[#f3eddb] text-[#f3eddb]">
      <iframe
        src="./finger_marble_mano.html?v=browser-onnx-mano"
        title="3D Motion Marbling"
        className="fixed inset-0 h-dvh w-screen border-0"
        allow="camera; fullscreen"
      />
    </main>
  );
}
