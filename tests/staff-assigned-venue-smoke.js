/* eslint-disable no-unused-expressions -- Playwright CLI run-code requires a bare async function expression. */
async (page) => {
  const assignedVenueId = '71000000-0000-4000-8100-000000000001';
  const target = 'https://zylush.github.io/rally-point-web/';
  const backend = 'https://iclrvvsiwypxlwrwgqia.supabase.co/rest/v1/';
  const errors = [], failed = [];
  const reads = { courts: [], bookings: [] };
  let phase = 'courts';
  const pathname = url => url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
  const tableName = url => pathname(url).split('/').at(-1);
  const hasAssignedVenue = url => {
    try {
      const query = decodeURIComponent(url.split('?')[1] || '').split('#')[0];
      return query.split('&').includes(`venue_id=eq.${assignedVenueId}`);
    } catch { return false; }
  };
  const venueResponse = () => page.waitForResponse(response =>
    response.request().method() === 'GET' && pathname(response.url()) === '/rest/v1/venues');
  const checkAssignedVenue = async response => {
    if (!response.url().startsWith(backend)) throw new Error('Staff venue API used unexpected backend');
    if (response.status() !== 200) throw new Error('Staff venue API request failed');
    const venues = await response.json();
    if (!Array.isArray(venues) || venues.length !== 1 || venues[0].id !== assignedVenueId)
      throw new Error('Staff venue API returned unexpected rows');
  };
  const checkReads = (stage, expectedTables) => {
    for (const read of reads[stage]) {
      if (!read.backend) throw new Error(`Unexpected backend for ${read.table} GET on ${stage} route`);
      if (!read.scoped) throw new Error(`Unscoped ${read.table} GET on ${stage} route`);
    }
    for (const table of expectedTables) {
      const matches = reads[stage].filter(read => read.table === table);
      if (!matches.length) throw new Error(`Missing ${table} GET on ${stage} route`);
    }
  };

  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) failed.push(`${response.status()} ${pathname(response.url())}`);
  });
  page.on('request', request => {
    if (request.method() !== 'GET') return;
    const path = pathname(request.url());
    if (!['/rest/v1/courts', '/rest/v1/court_sessions', '/rest/v1/bookings'].includes(path)) return;
    reads[phase].push({ table: tableName(request.url()), backend: request.url().startsWith(backend),
      scoped: hasAssignedVenue(request.url()) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const courtsVenue = venueResponse();
  await page.goto(`${target}#/staff/courts`);
  await checkAssignedVenue(await courtsVenue);
  await page.getByText('Tenant Fixture Rally Court', { exact: true }).first().waitFor();
  checkReads('courts', ['courts', 'court_sessions']);
  if (await page.getByText('Court A', { exact: true }).count())
    throw new Error('Unassigned court visible on staff courts route');
  if (await page.locator('#staff-venue option').count() > 1)
    throw new Error('Extra venue option on staff courts route');
  const phone = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  await page.keyboard.press('Tab');
  await page.getByRole('button').first().focus();
  const focus = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);

  phase = 'bookings';
  const bookingsVenue = venueResponse();
  await page.goto(`${target}#/staff/bookings`);
  await checkAssignedVenue(await bookingsVenue);
  await page.getByText('Tenant Fixture Rally Court', { exact: false }).first().waitFor();
  checkReads('bookings', ['bookings']);
  if (await page.getByText('Court A', { exact: true }).count())
    throw new Error('Unassigned court visible on staff bookings route');
  if (await page.locator('#bookings-venue option').count() > 1)
    throw new Error('Extra venue option on staff bookings route');
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktop = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  if (phone.documentWidth > phone.width || desktop.documentWidth > desktop.width)
    throw new Error('Staff route horizontal overflow');
  if (focus === 'none') throw new Error('Staff route focus indicator missing');
  if (errors.length || failed.length) throw new Error('Staff route browser or API error');

  return { result: 'PASS', courtReads: reads.courts.length, bookingReads: reads.bookings.length,
    assignedVenueOnly: true, phone, desktop, focus };
}
