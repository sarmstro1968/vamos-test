# EXEQ proof of concept

Formerly VAMOS. Setting names and CRM tags still use the `vamos` prefix so existing settings and workflows keep working.

A phone web page plus a small server. The salesman picks a CRM contact, confirms
consent, records (or uploads) a meeting, and EXEQ transcribes it, saves the
transcript on the contact, and asks before running any macro it heard.

**Quick command:** tap "Tap to speak" and say who and what, for example
"Send Ian Armstrong the onboarding sequence." EXEQ finds the macro and the
contact in the CRM and asks before it runs. If several contacts match, you pick
one. Commands can also be typed. The clip is only used to read the command;
nothing is saved except a note on the contact once you say yes.

## Files

| File | What it is |
|---|---|
| `index.html` | The phone page |
| `server.js` | The server (no dependencies, Node 18+) |
| `macros.json` | Your macros: spoken phrase, tag, label |
| `lib/crm-ghl.js` | GHL connector (swap to support another CRM) |
| `lib/transcribe-deepgram.js` | Deepgram connector |
| `lib/macros.js` | Fuzzy phrase matching |
| `lib/command.js` | Quick commands: finds the macro and the person's name |

## Settings (environment variables)

Set these in your hosting account. They never go in the code.

| Name | Value |
|---|---|
| `DEEPGRAM_API_KEY` | Your Deepgram key |
| `GHL_TOKEN` | Your GHL private integration token (`pit-...`) |
| `GHL_LOCATION_ID` | Your GHL sub-account location ID |
| `VAMOS_PASSCODE` | A passcode you invent. The page asks for it once per phone. |
| `VAMOS_TIMEZONE` | Optional. Defaults to `America/Chicago`. |
| `VAMOS_NEW_CONTACT_TAG` | Optional. Tag for contacts created in the app. Defaults to `added-via-vamos`. |

## Put it online

The microphone only works over HTTPS, so it has to be hosted.

1. Create a free GitHub account, make a new private repository, and upload
   every file in this folder (keep the `lib` folder).
2. Create a Render account, choose New > Web Service, and connect that repository.
3. Runtime: Node. Build command: leave empty (or `npm install`). Start command: `node server.js`.
4. Add the settings from the table above under Environment.
5. Deploy, then open the Render URL on your phone and enter your passcode.

Any host that runs a Node server works the same way.

## In GHL

For each macro, create a workflow with the trigger "Contact Tag", filter
"Tag Added" = the macro's tag, then add your actions. Make "Remove tag" the last
step so the macro can run again for the same contact later.

| Macro | Tag | Workflow |
|---|---|---|
| Sales Sequence Bravo | `vamos-sales-bravo` | Terms of service email and invoice |
| Onboarding Sequence | `vamos-onboarding` | Welcome email and onboarding instructions (build this one) |

## Add a macro

Add a block to `macros.json` and build a GHL workflow on its tag:

```json
{ "id": "hire-alpha", "label": "Hiring Sequence Alpha",
  "phrase": "initiate hiring sequence alpha",
  "commands": ["hiring sequence alpha", "offer letter"],
  "tag": "vamos-hire-alpha",
  "description": "Sends the offer letter." }
```

`phrase` is what to say during a recorded meeting. `commands` are the short
names a quick command listens for ("Send Dana Whitfield the offer letter").
If you leave `commands` out, the label is used.

## What this version does not do yet

- Login with a GHL or Google ID (one shared passcode instead)
- Text-message confirmation (you confirm on the page)
- AI matching (uses fuzzy text matching, which catches small slips)
- Audio retention settings (audio is passed straight to Deepgram and never stored by VAMOS)
