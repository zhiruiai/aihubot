import './AppBrandMark.css';

export function AppBrandMark({ size = 32 }: { size?: number }) {
  return (
    <img
      className="app-brand-mark"
      src="/favicon.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
