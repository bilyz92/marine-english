import { SiteFooter } from "../(site)/site-footer";
import { SiteHeader } from "../(site)/site-header";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}
