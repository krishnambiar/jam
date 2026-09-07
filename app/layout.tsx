import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://untitled-jam.groovy-wolf-5505.chatgpt.site'),
  title: 'Untitled Jam',
  description: 'A collaborative whiteboard canvas for arranging and editing pasted images.',
  openGraph: {
    title: 'Untitled Jam',
    description:
      'A collaborative whiteboard canvas for arranging and editing pasted images.',
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
    description:
      'A collaborative whiteboard canvas for arranging and editing pasted images.',
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
