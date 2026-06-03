import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChatManager · LibreChat 扩展',
  description: '比赛用户批量创建与管理控制台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
