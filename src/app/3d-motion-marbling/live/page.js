export const metadata = {
  title: "Live 3D Motion Marbling | Holland Blumer",
  description:
    "Local Python MANO fitting mode for the 3D Motion Marbling experiment.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LiveThreeDMotionMarblingPage() {
  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-[#f3eddb] text-[#f3eddb]">
      <iframe
        src="/3d-motion-marbling/finger_marble_mano.html?v=balanced-local-python-mano-live&api=http%3A%2F%2F127.0.0.1%3A8000&fit=1"
        title="Live 3D Motion Marbling"
        className="fixed inset-0 h-dvh w-screen border-0"
        allow="camera; fullscreen"
      />
    </main>
  );
}
