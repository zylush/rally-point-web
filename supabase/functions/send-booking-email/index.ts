import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createBookingEmailHandler, type DbClient } from './handler.ts'

// Emails a signed-in player about one of their own bookings. The request handling lives in
// handler.ts; this file only passes in Deno's settings, supabase-js and fetch.
Deno.serve(
  createBookingEmailHandler({
    env: (name) => Deno.env.get(name),
    // supabase-js's query types are too deep for TypeScript to compare with DbClient (TS2589),
    // so the client goes in as the part of it handler.ts uses. The handler suite
    // (tests/send-booking-email-handler.test.ts) runs it against the real supabase-js client.
    createClient: (url, key, options) => createClient(url, key, options) as unknown as DbClient,
    fetch: (url, init) => fetch(url, init),
  }),
)
