import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** The wordmark, on a light or a dark ground. */
export function Logo({ dark = false, className, href = "/", width = 140 }: { dark?: boolean; className?: string; href?: string; width?: number }) {
  const img = (
    <Image
      src={dark ? "/applya-logo-dark.png" : "/applya-logo-light.png"}
      alt="Applya"
      width={width}
      height={Math.round(width * (320 / 1300))}
      priority
      className={cn("h-auto", className)}
    />
  );
  return href ? <Link href={href} aria-label="Applya home">{img}</Link> : img;
}
