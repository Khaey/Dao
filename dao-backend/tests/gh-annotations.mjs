// TEMPORARY diagnostic reporter (#214): print failing tests as GitHub annotations.
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type === 'test:fail') {
      const e = event.data.details?.error; const msg = String(e?.cause?.message ?? e?.message ?? e).replace(/\r?\n/g, ' ').slice(0, 900);
      yield `::error title=${String(event.data.file ?? '').split('/').pop()} :: ${event.data.name}: ${msg}\n`;
    }
  }
}
