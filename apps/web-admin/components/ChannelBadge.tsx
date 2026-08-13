const CHANNEL_STYLES: Record<string, { label: string; className: string }> = {
  airbnb: { label: "Airbnb", className: "bg-rose-100 text-rose-700" },
  booking_com: { label: "Booking.com", className: "bg-blue-100 text-blue-700" },
  direct: { label: "Direct", className: "bg-neutral-900 text-white" },
  ical: { label: "iCal", className: "bg-purple-100 text-purple-700" },
};

export function ChannelBadge({ channel }: { channel: string }) {
  const style = CHANNEL_STYLES[channel] ?? { label: channel, className: "bg-neutral-100 text-neutral-600" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.className}`}>{style.label}</span>;
}
