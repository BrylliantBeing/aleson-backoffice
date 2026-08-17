# Aleson print agent

Prints passage tickets on the counter's **Epson TM-T82X** (80mm thermal) from
the back office running in a browser.

## Why this exists

The ticket carries a QR code the boarding gate scans, and it is printed as raw
**ESC/POS** so the printer generates that QR itself. A browser cannot open a
USB printer, and `window.print()` would hand the job to the Windows driver —
which rasterises, pops a dialog on every sale, and destroys the byte stream the
QR command depends on.

```
Browser (https://backoffice.…)      the TM-T82X is USB-attached to this PC,
   │   POST http://127.0.0.1:9101/print       and a browser cannot open it
   ▼
print agent (this)  ──RAW──▶  Windows spooler  ──▶  Epson TM-T82X
```

The whole ticket is printed onto blank thermal roll — logo, details, QR, VAT
breakdown and terms. Nothing is overprinted into a pre-printed form, so there is
**no alignment to calibrate**: a layout change is a back office redeploy and
never a visit to every counter. This agent prints bytes and should almost never
need updating.

## Install (per counter PC)

1. Install **Python 3.10+**, ticking *Add python.exe to PATH*.
2. Install the TM-T82X and confirm it prints a Windows test page.
3. **Add a RAW queue** — see below. This step is not optional.
4. Copy this `print-agent` folder to the PC, e.g. `C:\aleson\print-agent`.
5. `copy config.example.json config.json`, set `printer` to the RAW queue's
   exact name and `allowed_origins` to the back office's URL.
6. Double-click `run-agent.bat`. First run builds the virtualenv; after that it
   starts in a second or two.
7. Leave the window open, or start it automatically (below).

Check it with <http://127.0.0.1:9101/healthz> — it lists every printer Windows
can see, which is the quickest way to get the name in step 5 exactly right.

### The RAW queue — read this before debugging anything

Epson's in-box **class drivers are XPS-based and have no passthrough for raw
bytes**. Point the agent at such a queue and every job will be accepted, drain
out of the queue, report `{"ok": true}`, leave `Get-Printer` showing
`PrinterStatus Normal` / `JobCount 0` — and print nothing at all. Every layer
reports success, so this looks like an application bug and is not.

Create a second queue on the same port with a passthrough driver:

```powershell
Add-PrinterDriver -Name "Generic / Text Only"
Add-Printer -Name "TM-T82X RAW" -DriverName "Generic / Text Only" -PortName "USB001"
```

Use the port the printer actually landed on (`Get-PrinterPort`). The original
Epson queue can stay — it is fine for ordinary Windows printing, just not for
raw ESC/POS. Then pin `"printer": "TM-T82X RAW"` in `config.json`; with no
printer pinned the agent falls back to the Windows *default*, which is usually
the queue that eats jobs.

**If tickets do not print, check `DriverName` on the target queue before
touching anything else:** `Get-Printer | Select Name,DriverName`.

## Start it automatically

Task Scheduler → *Create Task*:

- **General**: Run only when user is logged on; name it `Aleson print agent`.
- **Triggers**: *At log on*.
- **Actions**: Start a program → `C:\aleson\print-agent\run-agent.bat`,
  *Start in* `C:\aleson\print-agent`.
- **Settings**: untick *Stop the task if it runs longer than…*.

## Connect the back office

Open **Printer setup** (printer icon, top right of the booking screen):

1. Turn **Print tickets on this PC** on.
2. Leave the agent URL at `http://127.0.0.1:9101` unless you changed the port.
   The status pill turns green when the agent answers.
3. Pick the **RAW** queue, not the Epson one.
4. **Test print** — a sample ticket with obviously fake values and a sample QR.
5. **Save**. Settings are stored per machine, so each counter keeps its own
   printer and a cashier who logs in elsewhere gets that counter's setup.

### Logo

The Aleson logo lives in the printer's own flash, not in the job. Upload it once
per printer with Epson's TM utility, then put the two-character key it was
stored under into **Logo key (NV)** in Printer setup. Left blank, the ticket
prints without it — everything else is unaffected.

### QR size

Default is 6 dots per module, roughly 25mm at 203 dpi. Raise it if tickets come
back hard to scan at the gate; the trade is a slightly longer ticket.

## Security

- Binds to `127.0.0.1` only — it is not reachable from the network.
- Refuses any origin outside the allowlist, so a random web page cannot print.
- Caps a job at 512 KB.
- It prints bytes and does nothing else: no filesystem, no database, no
  outbound calls.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Agent says `ok`, queue empties, nothing prints, no noise | The queue's driver does not pass RAW through. See *The RAW queue* above. |
| Status pill stays red | Agent not running, or a firewall prompt was denied. Reopen `run-agent.bat` and check `/healthz`. |
| Blocked in the browser console, mentions "private network" | The back office's URL is missing from `allowed_origins` in `config.json`. |
| `Printer 'X' not found` | `config.json` names a queue Windows does not have; the error lists the ones it does. |
| QR will not scan at the gate | Raise the QR size in Printer setup. Check the roll is not thermally faded or printed with the head too light. |
| Prints garbled text | Another app left the printer in a strange mode. The agent resets it at the start of each job, so this normally clears on the next print. |
