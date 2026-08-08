// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./index";

describe("<vacation-booking-widget>", () => {
  let element: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            nights: [
              { date: "2028-02-01", status: "available", priceInCents: 10000 },
              { date: "2028-02-02", status: "booked", priceInCents: 10000 },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    element = document.createElement("vacation-booking-widget");
    element.setAttribute("unit-id", "unit-1");
    element.setAttribute("account-id", "account-1");
    element.setAttribute("api-url", "https://api.example.com");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    vi.unstubAllGlobals();
  });

  it("renders check-in/check-out inputs and a Book Now button in shadow DOM", () => {
    const shadowRoot = element.shadowRoot!;
    expect(shadowRoot.getElementById("check-in")).toBeTruthy();
    expect(shadowRoot.getElementById("check-out")).toBeTruthy();
    expect(shadowRoot.getElementById("book-now")).toBeTruthy();
  });

  it("lists fetched unavailable dates after loading", async () => {
    await vi.waitFor(() => {
      expect(element.shadowRoot!.textContent).toContain("2028-02-02");
    });
  });

  it("dispatches vacation-booking:book with the selected range when dates are valid", async () => {
    await vi.waitFor(() => {
      expect(element.shadowRoot!.textContent).toContain("2028-02-02");
    });

    const shadowRoot = element.shadowRoot!;
    const checkIn = shadowRoot.getElementById("check-in") as HTMLInputElement;
    const checkOut = shadowRoot.getElementById("check-out") as HTMLInputElement;
    checkIn.value = "2028-03-01";
    checkOut.value = "2028-03-03";

    const handler = vi.fn();
    element.addEventListener("vacation-booking:book", handler);

    (shadowRoot.getElementById("book-now") as HTMLButtonElement).click();

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({
      unitId: "unit-1",
      accountId: "account-1",
      checkIn: "2028-03-01",
      checkOut: "2028-03-03",
    });
  });

  it("shows an error instead of dispatching when the selected range overlaps a booked night", async () => {
    await vi.waitFor(() => {
      expect(element.shadowRoot!.textContent).toContain("2028-02-02");
    });

    const shadowRoot = element.shadowRoot!;
    const checkIn = shadowRoot.getElementById("check-in") as HTMLInputElement;
    const checkOut = shadowRoot.getElementById("check-out") as HTMLInputElement;
    checkIn.value = "2028-02-01";
    checkOut.value = "2028-02-03";

    const handler = vi.fn();
    element.addEventListener("vacation-booking:book", handler);

    (shadowRoot.getElementById("book-now") as HTMLButtonElement).click();

    expect(handler).not.toHaveBeenCalled();
    expect(shadowRoot.textContent).toContain("not available");
  });
});
