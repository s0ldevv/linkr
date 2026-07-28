type XLogoProps = {
  className?: string;
};

export function XLogo({ className }: XLogoProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 1200 1227"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M714.2 519.3 1160.9 0h-105.9L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9l409.6-476.2 327.2 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l304.8 436 47.5 67.9 396.2 566.7H892.5L569.2 687.8Z" />
    </svg>
  );
}
