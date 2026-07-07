import type { ReactNode } from "react";
import { statusLabel } from "./format";

export function cx(...p: Array<string | false | null | undefined>): string {
  return p.filter(Boolean).join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("badge", `s-${status}`)}>
      <span className={cx("dot", `d-${status}`)} />
      {statusLabel(status)}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("card", className)}>
      {title != null ? (
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <div className="csub">{subtitle}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
    </div>
  );
}

export function Tile({
  label,
  value,
  dot,
  hint,
}: {
  label: string;
  value: ReactNode;
  dot?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="tile">
      <div className="label">
        {dot ? <span className={cx("dot", dot)} /> : null}
        {label}
      </div>
      <div className="value tabular">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "err";
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx("alert", tone)}>
      {title ? <strong>{title}</strong> : null}
      {children ? <div style={{ marginTop: title ? 4 : 0 }}>{children}</div> : null}
    </div>
  );
}
