import RoleNav from './RoleNav';
import NotificationShortcut from './NotificationShortcut';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-sand"><div className="flex min-h-screen"><RoleNav /><div className="min-w-0 flex-1 pt-16 lg:pt-0"><main className="relative mx-auto w-full max-w-[1500px] [&_.grid>*]:min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8"><NotificationShortcut />{children}</main></div></div></div>;
}
