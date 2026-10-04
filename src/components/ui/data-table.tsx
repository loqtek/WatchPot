import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-line bg-surface", className)} {...props} />
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-line bg-recessed", className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-black/[0.06]", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-recessed", className)} {...props} />;
}

export function Th({ className, children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("px-4 py-3 text-left align-middle text-xs font-medium text-muted", className)} {...props}>
      {children}
    </th>
  );
}

export function Td({
  className,
  children,
  mono,
  ...props
}: HTMLAttributes<HTMLTableCellElement> & { mono?: boolean }) {
  return (
    <td className={cn("px-4 py-3.5 text-body", mono && "font-mono text-xs text-muted", className)} {...props}>
      {children}
    </td>
  );
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}
