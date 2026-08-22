This is a Next.js hostel leave automation project.

## How It Works

1. A student submits one free-form leave request from the home page.
2. `app/api/leave-request/route.js` sends that text to Gemini, which extracts the leave fields, calculates the number of days, evaluate risk of sending this student as `low`, `medium` or `high` and writes a parent `email draft`.
3. The enriched request is saved as a new row in the Notion leave database with `Email Status` set to `Not_Sent`.
4. so now the request of the student is stored in the notion db as a single row with all necessary arrtibute/coulmn and now this is the point where we need `human in the loop`, our warden who just need to check the request of student and select the `status` between `Approve` or `Reject`.
4. `app/api/cron-processor/route.js` is called every minute by cron-job.org on the Render web service. It finds rows with `Status = Approve` and `Email Status = Not_Sent`.
5. The worker generates a gate pass ID and QR code, emails the parent draft to parent and gate pass ID, QR code to student, then changes `Email Status` to `Sent`. A failed row is marked `Error` so it is not repeatedly emailed.

## Required Environment Variables

Set these in `.env` for local development and in the Vercel project settings for deployment:

```env
GEMINI_API_KEY=your_gemini_key

NOTION_API_KEY=your_notion_integration_token
NOTION_LEAVE_DATABASE_ID=your_leave_database_id
NOTION_RUN_LOG_DB_ID=your_run_log_database_id
NOTION_APPROVED_STATUS=Approve

CRON_SECRET=your_long_random_secret

GMAIL_SCRIPT_URL=https://script.google.com/macros/s/.../exec
```

## Running Locally

```bash
cd hostel_leave_automation
npm install
npm run dev
```

The form is available at `http://localhost:3000`. The worker endpoint is `POST /api/cron-processor` and requires an `Authorization: Bearer YOUR_CRON_SECRET` header.

for checking the workers you can write command in the terminal when you are in localhost:
```bash
curl -i -X POST \                                           
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/cron-processor   
```

## Render And cron-job.org

The included `render.yaml` uses `npm run build` and `npm start`. In Render, add the secret environment variables and deploy the web service. Configure cron-job.org as follows:

- URL: `https://YOUR-RENDER-SERVICE.onrender.com/api/cron-processor`
- Method: `POST`
- Schedule: every 1 minute
- Header: `Authorization: Bearer YOUR_CRON_SECRET`
- Header: `Content-Type: application/json`

An idle worker returns `200` with `processed: 0`. A failed row is logged, marked `Error`, and does not stop other rows from being processed.

## Apps script
we have used here the app script for sending email to parents and students.

## website Tech stack
* front-end : React
* backend : Next.js
* useful dependencies : @google/client, @notionhq/client, qrcode

## Notion Status Values

The leave database uses these exact status values:

- `Not started`: initial state for a new request.
- `Approve`: the warden-approved state that enables email processing.
- `Not_Sent`: emails have not been dispatched yet.
- `Sent`: both emails were dispatched successfully.
- `Error`: processing failed for that row.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Deployed on render

it is because we need a lot of corn job to done which is not possible in the free tier of the vercel

## [Demo video 💻](https://drive.google.com/file/d/1av0YiSWRlks-dZoakfqn_64WT18cjvZq/view?usp=drivesdk)
