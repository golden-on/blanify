import { notFound } from "next/navigation";
import { GuestCheckInForm } from "@/components/GuestCheckInForm";

interface GuestPortalData {
  reservation: { checkIn: string; checkOut: string; status: string };
  unit: { name: string; checkInInstructions: string | null } | null;
  property: { name: string; address: string | null } | null;
  lockCode: { code: string; startsAt: string; endsAt: string } | null;
  checkInCompletedAt: string | null;
  signedAgreementUrl: string | null;
}

async function fetchGuestPortalData(token: string): Promise<GuestPortalData | null> {
  const apiServerUrl = process.env.API_SERVER_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiServerUrl}/api/v1/public/guest/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as GuestPortalData;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function GuestPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await fetchGuestPortalData(token);
  if (!data) {
    notFound();
  }

  const { reservation, unit, property, lockCode, checkInCompletedAt } = data;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-neutral-50 px-4 py-8">
      <header>
        <p className="text-sm font-medium text-neutral-500">{property?.name ?? "Your stay"}</p>
        <h1 className="text-2xl font-semibold text-neutral-900">{unit?.name ?? "Guest portal"}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {reservation.checkIn} → {reservation.checkOut}
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Check-in status</h2>
        {checkInCompletedAt ? (
          <p className="mt-2 text-sm text-green-700">Completed on {formatDateTime(checkInCompletedAt)}</p>
        ) : (
          <p className="mt-2 text-sm text-neutral-600">Not completed yet — fill out the form below before you arrive.</p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Door code</h2>
        {lockCode ? (
          <>
            <p className="mt-2 text-3xl font-bold tracking-widest text-neutral-900">{lockCode.code}</p>
            <p className="mt-1 text-xs text-neutral-500">
              Valid {formatDateTime(lockCode.startsAt)} – {formatDateTime(lockCode.endsAt)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-600">Your door code will appear here once it&apos;s issued.</p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Guidebook</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">
          {unit?.checkInInstructions ?? "Your host hasn't added check-in instructions yet."}
        </p>
      </section>

      {!checkInCompletedAt && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Complete check-in</h2>
          <GuestCheckInForm token={token} />
        </section>
      )}
    </main>
  );
}
