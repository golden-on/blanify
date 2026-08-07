export interface WidgetConfig {
  accountId: string;
}

export function init(config: WidgetConfig): void {
  console.log("Blanify widget initialized", config);
}
