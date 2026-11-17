import "./globals.css";

export const metadata = {
  title: "Holland Blumer",
  description: "Holland Blumer portfolio",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
