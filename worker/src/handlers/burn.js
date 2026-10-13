export async function burn(ms) {
  const end = Date.now() + ms * Number(process.env.DURATION_SCALE || 1);
  while (Date.now() < end) {
    const slice = Date.now() + 50;
    while (Date.now() < slice) Math.sqrt(Math.random());
    await new Promise((r) => setImmediate(r));
  }
}
