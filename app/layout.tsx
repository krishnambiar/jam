import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Untitled Jam',
  description: 'A static collaborative whiteboard interface.',
  openGraph: {
    title: 'Untitled Jam',
    description: 'A static collaborative whiteboard interface.',
    images: [
      {
        url: '/og.png',
        width: 1536,
        height: 1024,
        alt: 'Untitled Jam whiteboard interface preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Untitled Jam',
    description: 'A static collaborative whiteboard interface.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
