# Recorder

The recorder shows the gateway flight log in a terminal pane.

## Parts

- `GET /admin/flight/head` returns the cursor: the number of the last event in the log.
- `GET /admin/flight/stream?after=N` is a push stream (server-sent events). It sends every event after N, then each new event as it commits. Each frame has `id: <seq>` and `data: <json>`. A comment line (`: ping`) goes out every 15 seconds so a quiet connection stays open. The gateway reads it with `FlightLog.events`.
- `GET /admin/flight` returns every row, read in pages of 500. Test harnesses use it. The recorder does not.
- `src/recorder/record.ts` reads the stream. It prints one line per event and appends the event to a JSONL file. If the stream ends or fails, it prints `mcp-trust waiting for the gateway`, waits 500 ms, and reconnects with `after=<last seq it wrote>`. It skips any frame at or below its cursor.
- `src/recorder/pane.ts` opens the recorder in a Rex pane with `rex split`, reads it with `rex capture`, and closes it with `rex block close`.
- `src/recorder/replay.ts` rebuilds the rows from the recorded events with `rowOf` (the same function the gateway uses) and hashes them. The hash is sha256 over canonical JSON with sorted keys.
- `bin/mcp-trust.ts` is the command line: `watch`, `record`, `replay`, `close`. `--access-app URL` makes the recorder send a `cf-access-token` from `cloudflared access token`.

## The view

`FlightLog` has no state. For each event of the three aggregates it emits one `FlightLogged` event with the session, the time and the raw event. The row (`rowOf` in `src/domain/flight-row.ts`) is built from that event and its number in the stream. The cost of one event does not depend on the size of the log: `receipts/e4-flight-stream-cost.json` shows a p95 of 292 ms with 4,300 rows and 290 ms with 40,200 rows.

The earlier view kept every row in its state, and the platform stored that state after each event. That cost grew with the log, about 3.9 GB of local state for 4,000 rows. The receipts from that design are kept: `e3-flight-recorder-long-poll.json`, `e3b-recorder-reconnect-long-poll.json`, `e3-flight-recorder-before-page-cap.json`.

## Display modes

Full mode prints one line per event. Compact mode (`--compact` on `watch` and `record`) prints only calls, writes and refusals, one line each, 60 characters or fewer. It hides registration, `TargetsNamed` and reads. The JSONL file always holds every event.

Colors: red for refusals, green for allowed writes and pinned calls, yellow for a call that reached an unpinned provider with a same-name collision, dim for the rest. The recorder keeps a note of collisions for each session. It calls a provider a lookalike when its name extends the name of another provider in the same collision. This is a display rule only.

## What replay proves

Replay applies the same row function to the recorded events. It shows that the recording has every event, once, in order, and that the rows it makes equal the rows the gateway reads from its log. It does not show that the row function is correct. The domain stories cover that.

## Limits

- Delivery takes about 150 ms at the median and 290 ms at p95 on a local run. The time is the same with a small log and a large one. It is not shorter than the long poll it replaced (p50 123 ms, p95 276 ms in the first E3 run). The gain is the flat cost, not speed.
- A token is checked when a stream starts. A stream stays open after its token expires.
- If the connection drops, the recorder reconnects and resumes from its last event. `receipts/e3b-recorder-reconnect.json` shows 0 lost and 0 duplicated. In that run the second cut came after the traffic had ended, so only the first cut held events.
- A killed and restarted recorder has no resume flag. It starts from the `--after` value you give it.
- The log persists between local runs, so a run starts from the cursor from `/admin/flight/head`.
