import { Mail, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SITE = "https://kijabehospital.or.ke";

const pillCls =
  "group flex h-14 w-14 items-center justify-start overflow-hidden whitespace-nowrap rounded-full bg-gradient-to-r from-[#0c729c] to-[#60a5fa] text-white shadow-lg transition-all duration-300 ease-in-out hover:w-36 hover:from-[#095475] hover:to-[#3b82f6] focus-visible:w-36 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";
const iconCls = "flex h-14 w-14 flex-shrink-0 items-center justify-center";
const labelCls =
  "pr-4 text-sm font-semibold opacity-0 transition-opacity delay-100 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100";

export function HospitalSupportPills() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed bottom-6 left-6 z-40 max-sm:bottom-4 max-sm:left-4">
        <a
          href={`${SITE}/Feedback/Survey`}
          target="_blank"
          rel="noopener noreferrer"
          title="Give Feedback"
          aria-label="Give Feedback"
          className={pillCls}
        >
          <span className={iconCls}>
            <ThumbsUp className="h-5 w-5" />
          </span>
          <span className={labelCls}>Feedback</span>
        </a>
      </div>

      <div className="fixed bottom-6 right-6 z-40 max-sm:bottom-4 max-sm:right-4">
        <a
          href="mailto:info@kijabehospital.org?subject=Kijabe%20Hospital%20enquiry"
          title="Email Us"
          aria-label="Email Us"
          className={pillCls}
        >
          <span className={iconCls}>
            <Mail className="h-5 w-5" />
          </span>
          <span className={labelCls}>Email Us</span>
        </a>
      </div>
    </>,
    document.body,
  );
}
