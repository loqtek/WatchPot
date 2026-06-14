"use client";

import { useSearchParams } from "next/navigation";
import { LogWallView } from "@/components/log-wall/log-wall-view";

export default function LogWallPage() {
  const searchParams = useSearchParams();
  const potId = searchParams.get("pot_id") ?? searchParams.get("pot") ?? undefined;

  return <LogWallView initialPotId={potId || undefined} />;
}
