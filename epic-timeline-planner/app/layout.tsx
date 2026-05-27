import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bird Eye Viewer",
  description: "Bird's-eye roadmap planning across quarters, months, and sprints",
  icons: {
    icon: "/bird-eye-bubble.png",
    shortcut: "/bird-eye-bubble.png",
    apple: "/bird-eye-bubble.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Inter loaded directly from Google Fonts (preconnect + stylesheet
            link). `--font-sans` in globals.css points at "Inter, sans-serif",
            so Tailwind's `font-sans` resolves to Inter everywhere. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
