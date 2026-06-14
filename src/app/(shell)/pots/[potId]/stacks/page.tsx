import { redirect } from "next/navigation";

export default async function LegacyPotStacksRedirect({ params }: { params: Promise<{ potId: string }> }) {
  const { potId } = await params;
  redirect(`/pots/${potId}`);
}
