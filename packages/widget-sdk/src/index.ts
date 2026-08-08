const AVAILABILITY_WINDOW_DAYS = 90;

interface NightAvailability {
  date: string;
  status: "available" | "booked" | "blocked";
  priceInCents: number | null;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class VacationBookingWidget extends HTMLElement {
  #root: ShadowRoot;
  #nights: NightAvailability[] = [];
  #errorText = "";

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this.#render();
    void this.#loadAvailability();
  }

  get #unitId(): string {
    return this.getAttribute("unit-id") ?? "";
  }

  get #accountId(): string {
    return this.getAttribute("account-id") ?? "";
  }

  get #apiUrl(): string {
    return this.getAttribute("api-url") ?? "";
  }

  async #loadAvailability(): Promise<void> {
    const start = new Date();
    const end = new Date(start.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const url = `${this.#apiUrl}/api/v1/public/units/${this.#unitId}/availability?start=${toDateInputValue(start)}&end=${toDateInputValue(end)}&accountId=${this.#accountId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.#errorText = "Unable to load availability right now.";
        this.#render();
        return;
      }
      const body = (await response.json()) as { nights: NightAvailability[] };
      this.#nights = body.nights;
      this.#render();
    } catch {
      this.#errorText = "Unable to load availability right now.";
      this.#render();
    }
  }

  #unavailableDates(): string[] {
    return this.#nights.filter((night) => night.status !== "available").map((night) => night.date);
  }

  #isRangeAvailable(checkIn: string, checkOut: string): boolean {
    const unavailable = new Set(this.#unavailableDates());
    let current = new Date(`${checkIn}T00:00:00Z`);
    const end = new Date(`${checkOut}T00:00:00Z`);
    while (current < end) {
      if (unavailable.has(current.toISOString().slice(0, 10))) return false;
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }
    return true;
  }

  #render(): void {
    const unavailable = this.#unavailableDates();

    this.#root.innerHTML = `
      <style>
        :host { display: block; font-family: system-ui, sans-serif; max-width: 320px; }
        .widget { border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
        label { display: block; font-size: 12px; margin-top: 8px; color: #444; }
        input { width: 100%; padding: 6px; margin-top: 2px; box-sizing: border-box; }
        button { margin-top: 12px; width: 100%; padding: 8px; background: #111; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
        .unavailable { margin-top: 8px; font-size: 11px; color: #888; max-height: 60px; overflow-y: auto; }
        .error { margin-top: 8px; font-size: 12px; color: #b00020; }
      </style>
      <div class="widget">
        <label for="check-in">Check-in</label>
        <input type="date" id="check-in" />
        <label for="check-out">Check-out</label>
        <input type="date" id="check-out" />
        <button id="book-now" type="button">Book Now</button>
        ${this.#errorText ? `<div class="error">${this.#errorText}</div>` : ""}
        ${
          unavailable.length > 0
            ? `<div class="unavailable">Unavailable: ${unavailable.join(", ")}</div>`
            : ""
        }
      </div>
    `;

    const bookButton = this.#root.getElementById("book-now");
    bookButton?.addEventListener("click", () => this.#handleBookNow());
  }

  #handleBookNow(): void {
    const checkIn = (this.#root.getElementById("check-in") as HTMLInputElement | null)?.value;
    const checkOut = (this.#root.getElementById("check-out") as HTMLInputElement | null)?.value;

    if (!checkIn || !checkOut || checkIn >= checkOut) {
      this.#errorText = "Select a valid check-in and check-out date.";
      this.#render();
      return;
    }

    if (!this.#isRangeAvailable(checkIn, checkOut)) {
      this.#errorText = "Selected dates are not available.";
      this.#render();
      return;
    }

    this.#errorText = "";
    this.dispatchEvent(
      new CustomEvent("vacation-booking:book", {
        bubbles: true,
        composed: true,
        detail: { unitId: this.#unitId, accountId: this.#accountId, checkIn, checkOut },
      }),
    );
  }
}

if (!customElements.get("vacation-booking-widget")) {
  customElements.define("vacation-booking-widget", VacationBookingWidget);
}
