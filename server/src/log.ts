// One JSON object per line on stdout, which systemd's journal and most hosts collect as they are.
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
