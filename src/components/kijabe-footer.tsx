import { Link } from "@tanstack/react-router";
import { Clock3, Mail, MapPin, Phone, Send } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const SITE = "https://kijabehospital.or.ke";

const SOCIAL_ICONS = {
  whatsapp: {
    viewBox: "0 0 448 512",
    path: "M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z",
  },
  facebook: {
    viewBox: "0 0 320 512",
    path: "M80 299.3V512H196V299.3h86.5l18-97.8H196V166.9c0-51.7 20.3-71.5 72.7-71.5c16.3 0 29.4 .4 37 1.2V7.9C291.4 4 256.4 0 236.2 0C129.3 0 80 50.5 80 159.4v42.1H14v97.8H80z",
  },
  x: {
    viewBox: "0 0 512 512",
    path: "M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z",
  },
  tiktok: {
    viewBox: "0 0 448 512",
    path: "M448,209.91a210.06,210.06,0,0,1-122.77-39.25V349.38A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,52.23,71.18V0l88,0a121.18,121.18,0,0,0,1.86,22.17h0A122.18,122.18,0,0,0,381,102.39a121.43,121.43,0,0,0,67,20.14Z",
  },
} as const;

type SocialIconKey = keyof typeof SOCIAL_ICONS;
type SocialMotion = "float" | "jello" | null;

function SocialIconLink({
  href,
  label,
  icon,
  hover,
}: {
  href: string;
  label: string;
  icon: SocialIconKey;
  hover: string;
}) {
  const [motion, setMotion] = useState<SocialMotion>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glyph = SOCIAL_ICONS[icon];

  const play = (next: Exclude<SocialMotion, null>) => {
    if (timer.current) clearTimeout(timer.current);
    setMotion(next);
    timer.current = setTimeout(() => setMotion(null), 820);
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      onMouseEnter={() => play("float")}
      onMouseLeave={() => play("jello")}
      onFocus={() => play("float")}
      onBlur={() => play("jello")}
      className={`group flex h-10 w-10 items-center justify-center rounded-full bg-[#1a3a55] text-white transition-[transform,background-color,box-shadow] duration-300 ease-out hover:scale-110 active:scale-95 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${hover}`}
    >
      <span className={`social-motion ${motion === "float" ? "social-float" : motion === "jello" ? "social-jello" : ""}`}>
        <span className="social-beat">
          <svg viewBox={glyph.viewBox} className="h-4 w-4 fill-current" aria-hidden="true" focusable="false">
            <path d={glyph.path} />
          </svg>
        </span>
      </span>
    </a>
  );
}

function Ext({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

const linkCls = "text-white transition-colors hover:text-[#159ed5]";

export function KijabeFooter() {
  const [email, setEmail] = useState("");

  return (
    <div className="relative z-10 mt-20">
      {/* Narrow flowing color stream — bridge between body and footer */}
      <div className="kijabe-color-stream" aria-hidden>
        <div className="kijabe-color-stream-band" />
      </div>

      <footer className="bg-[#102a43] pt-10 pb-16 text-white">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white">Quick Links</h3>
              <ul className="space-y-2 text-sm">
                <li><Link to="/" className={linkCls}>Home</Link></li>
                <li><Ext href={`${SITE}/AboutUs/ContactIndex`} className={linkCls}>Contact us</Ext></li>
                <li><Ext href={`${SITE}/Home/TelemedicineIndex`} className={linkCls}>Telemedicine Portal</Ext></li>
                <li><Ext href={`${SITE}/Recruit`} className={linkCls}>Careers</Ext></li>
                <li><Ext href={`${SITE}/Accountability/Login`} className={`${linkCls} font-bold`}>SLT Portal</Ext></li>
                <li><Ext href={`${SITE}/Accountability/BoardPortal`} className={linkCls}>Board Portal</Ext></li>
                <li>
                  <Ext href={`${SITE}/intranet`} className={linkCls}>
                    Staff Intranet <span className="text-xs text-white/50">(on site)</span>
                  </Ext>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white">Services</h3>
              <ul className="space-y-2 text-sm">
                <li><Ext href={`${SITE}/Services/Details/1`} className={linkCls}>Kijabe Hospital OutPatient</Ext></li>
                <li><Ext href={`${SITE}/Services/Details/2`} className={linkCls}>Kijabe Hospital Family Clinic</Ext></li>
                <li><Ext href={`${SITE}/Services/Details/3`} className={linkCls}>Dental Clinic</Ext></li>
                <li><Ext href={`${SITE}/Services/Details/4`} className={linkCls}>Mental Health Clinic</Ext></li>
                <li><Ext href={`${SITE}/Services/List`} className={linkCls}>More…</Ext></li>
                <li><Ext href={`${SITE}/Home/TelepharmacyProcess`} className={linkCls}>Order Medicine</Ext></li>
                <li><Ext href={`${SITE}/Notices`} className={linkCls}>Notices</Ext></li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white">Education</h3>
              <ul className="space-y-2 text-sm">
                <li><Ext href={`${SITE}/ShortCourses`} className={linkCls}>Medical Training</Ext></li>
                <li><Ext href="https://kchs.ac.ke/" className={linkCls}>Nursing School</Ext></li>
                <li><Ext href={`${SITE}/ShortCourses`} className={linkCls}>CME Courses</Ext></li>
                <li><Ext href={`${SITE}/Research/ResearchDay`} className={linkCls}>Research</Ext></li>
                <li><Ext href="http://library.kchs.ac.ke:443/" className={linkCls}>Students Library</Ext></li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white">Contact Us</h3>
              <ul className="space-y-2 text-sm text-white">
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#97c3db]" />
                  <span>Kijabe, Kiambu County, Kenya</span>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-[#97c3db]" />
                  <a href="tel:+254709728200" className={linkCls}>+254 709 728 200</a>
                </li>
                <li className="flex min-w-0 items-start gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#97c3db]" />
                  <a href="mailto:info@kijabehospital.org" className={`${linkCls} min-w-0 break-all`}>info@kijabehospital.org</a>
                </li>
                <li className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 shrink-0 text-[#97c3db]" />
                  <span>24/7 Emergency</span>
                </li>
              </ul>
            </div>

            <div className="col-span-2 md:col-span-1">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white">Connect</h3>
              <div className="mb-6 flex flex-wrap gap-3">
                {[
                  {
                    href: "https://api.whatsapp.com/send?phone=254709728200",
                    label: "WhatsApp",
                    icon: "whatsapp" as const,
                    hover: "hover:bg-[#25d366] hover:shadow-[0_10px_24px_-6px_rgba(37,211,102,0.6)]",
                  },
                  {
                    href: "https://x.com/kijabehospital",
                    label: "X",
                    icon: "x" as const,
                    hover: "hover:bg-black hover:shadow-[0_10px_24px_-6px_rgba(255,255,255,0.35)]",
                  },
                  {
                    href: "https://www.facebook.com/kijabehospital",
                    label: "Facebook",
                    icon: "facebook" as const,
                    hover: "hover:bg-[#1877f2] hover:shadow-[0_10px_24px_-6px_rgba(24,119,242,0.6)]",
                  },
                  {
                    href: "https://www.tiktok.com/@kijabe_hospital",
                    label: "TikTok",
                    icon: "tiktok" as const,
                    hover: "hover:bg-[#010101] hover:shadow-[0_10px_24px_-6px_rgba(37,244,238,0.55)]",
                  },
                ].map((s) => (
                  <SocialIconLink key={s.label} href={s.href} label={s.label} icon={s.icon} hover={s.hover} />
                ))}
              </div>

              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white">Newsletter</h3>
              <form
                className="flex w-full"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email.trim()) return;
                  toast.success("Thanks — newsletter signup noted.");
                  setEmail("");
                }}
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email"
                  className="min-w-0 flex-grow rounded-l border border-[#1a3a55] bg-[#1a3a55] px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-1 focus:ring-[#159ed5]"
                />
                <button
                  type="submit"
                  className="flex-shrink-0 rounded-r bg-[#159ed5] px-3 text-white transition hover:bg-[#1289b8]"
                  aria-label="Subscribe"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>

          <div className="mt-10 border-t border-[#1a3a55] pt-6 text-center text-sm text-white">
            <p>
              © {new Date().getFullYear()} Kijabe Hospital. All Rights Reserved.{" | "}
              <Ext href={`${SITE}/Home/Privacy`} className={linkCls}>Privacy Policy</Ext>
              {" | "}
              <Ext href={`${SITE}/Home/Terms`} className={linkCls}>Terms of Service</Ext>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
