import { Client } from "@notionhq/client";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

export const runtime = "nodejs";

const PROPERTY = {
  studentName: "Student Name",
  roomNumber: "Room no",
  destination: "Destination",
  reason: "Reason",
  outDate: "Out Date",
  inDate: "In Date",
  numberDays: "No. of Days",
  parentDraft: "Parent Draft",
  studentEmail: "Student Email",
  parentEmail: "Parent Email",
  status: "Status",
  gatePassId: "Gate Pass ID",
  emailStatus: "Email Status",
};

let isProcessing = false;

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return error?.body?.message || error?.message || JSON.stringify(error);
}

function getText(property) {
  if (!property) return null;

  if (property.type === "title") {
    return property.title?.map((item) => item.plain_text).join("") || null;
  }

  if (property.type === "rich_text") {
    return property.rich_text?.map((item) => item.plain_text).join("") || null;
  }

  if (property.type === "email") return property.email || null;
  if (property.type === "url") return property.url || null;
  if (property.type === "select") return property.select?.name || null;
  if (property.type === "status") return property.status?.name || null;
  if (property.type === "number") return property.number;
  if (property.type === "date") return property.date?.start || null;

  return null;
}

function getDatabaseId() {
  return (
    process.env.NOTION_LEAVE_DATABASE_ID || process.env.NOTION_LEAVE_DB_ID
  );
}

function getLogsDatabaseId() {
  return process.env.NOTION_LOGS_DATABASE_ID || process.env.NOTION_RUN_LOG_DB_ID;
}

function getApprovedStatus() {
  return process.env.NOTION_APPROVED_STATUS || "Approve";
}

function titleProperty(value) {
  return { title: [{ text: { content: String(value) } }] };
}

function textProperty(value) {
  return { rich_text: [{ text: { content: String(value || "None") } }] };
}

function selectProperty(value) {
  return { select: { name: value } };
}

function statusProperty(value) {
  return { status: { name: value } };
}

async function createRunLog(notion, { actionId, eventType, details, ok = true }) {
  const databaseId = getLogsDatabaseId();
  if (!databaseId) return;

  await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      action_id: titleProperty(actionId),
      event_type: selectProperty(eventType),
      // The live log database allows SUCCESS and ERROR in this status column.
      execution_status: statusProperty(ok ? "SUCCESS" : "ERROR"),
      error_details: textProperty(details),
    },
  });
}

async function safeCreateRunLog(notion, log) {
  try {
    await createRunLog(notion, log);
  } catch (error) {
    console.error("Failed to write lifecycle log:", getErrorMessage(error));
  }
}

function getEmailStatusPayload(propertyType, value) {
  if (propertyType === "select") {
    return { select: value ? { name: value } : null };
  }

  if (propertyType === "status") {
    return { status: value ? { name: value } : null };
  }

  throw new Error('Email Status must be a Notion status property.');
}

function getGatePassPayload(propertyType, value) {
  if (propertyType === "title") {
    return { title: [{ text: { content: value } }] };
  }

  if (propertyType === "number") {
    return { number: Number(value) };
  }

  return { rich_text: [{ text: { content: value } }] };
}

function getDateForEmail(value) {
  return value || "the approved leave dates";
}

function createTransporter() {
  // SMTP credentials stay on the server; they are never sent to the browser.
  const required = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing SMTP environment variables: ${missing.join(", ")}`);
  }

  return nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});
}

async function getDatabaseSchema(notion, databaseId) {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = database.data_sources?.[0]?.id || database.id;

  if (!dataSourceId) {
    throw new Error("No Notion data source was found for the leave database.");
  }

  let dataSource = null;
  let properties = database.properties || {};

  if (Object.keys(properties).length === 0 && database.data_sources?.[0]?.id) {
    dataSource = await notion.dataSources.retrieve({
      data_source_id: database.data_sources[0].id,
    });
    properties = dataSource.properties || {};
  }

  if (properties[PROPERTY.emailStatus]?.type !== "status") {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: {
        [PROPERTY.emailStatus]: { status: {} },
      },
    });

    dataSource = await notion.dataSources.retrieve({
      data_source_id: dataSourceId,
    });
    properties = dataSource.properties || {};
  }

  for (const propertyName of [PROPERTY.status, PROPERTY.emailStatus]) {
    if (!properties[propertyName]) {
      throw new Error(
        `Notion property "${propertyName}" is missing from the leave database.`,
      );
    }
  }

  return { properties, dataSourceId };
}

function createFilter(properties) {
  // Only approved rows that have not received email are eligible for processing.
  const emailStatusType = properties[PROPERTY.emailStatus].type;
  const emailStatusFilter =
    emailStatusType === "select"
      ? { select: { equals: "Not_Sent" } }
      : emailStatusType === "status"
        ? { status: { equals: "Not_Sent" } }
        : { status: { equals: "Not_Sent" } };

  return {
    and: [
      { property: PROPERTY.status, status: { equals: getApprovedStatus() } },
      { property: PROPERTY.emailStatus, ...emailStatusFilter },
    ],
  };
}

function createRejectFilter(properties) {
  const emailStatusType = properties[PROPERTY.emailStatus].type;
  const emailStatusFilter =
    emailStatusType === "status"
      ? { status: { equals: "Not_Sent" } }
      : { select: { equals: "Not_Sent" } };

  return {
    and: [
      { property: PROPERTY.status, status: { equals: "Reject" } },
      { property: PROPERTY.emailStatus, ...emailStatusFilter },
    ],
  };
}

function extractLeavePage(page) {
  const properties = page.properties || {};

  return {
    pageId: page.id,
    studentName: getText(properties[PROPERTY.studentName]),
    roomNumber: getText(properties[PROPERTY.roomNumber]),
    destination: getText(properties[PROPERTY.destination]),
    reason: getText(properties[PROPERTY.reason]),
    outDate: getText(properties[PROPERTY.outDate]),
    inDate: getText(properties[PROPERTY.inDate]),
    numberDays: getText(properties[PROPERTY.numberDays]),
    parentDraft: getText(properties[PROPERTY.parentDraft]),
    studentEmail: getText(properties[PROPERTY.studentEmail]),
    parentEmail: getText(properties[PROPERTY.parentEmail]),
  };
}

async function updateLeavePage(notion, pageId, properties) {
  await notion.pages.update({
    page_id: pageId,
    properties,
  });
}

function createGatePassId() {
  return `GP-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

async function processLeave({ notion, transporter, page, properties }) {
  const leave = extractLeavePage(page);
  const actionId = randomUUID();
  const gatePassId = createGatePassId();
  const emailStatusType = properties[PROPERTY.emailStatus].type;
  const gatePassType = properties[PROPERTY.gatePassId].type;

  if (!leave.parentEmail || !leave.studentEmail) {
    throw new Error("Both Parent Email and Student Email are required.");
  }

  await updateLeavePage(notion, leave.pageId, {
    // The gate pass is saved before email delivery so it can be traced on failure.
    [PROPERTY.gatePassId]: getGatePassPayload(gatePassType, gatePassId),
    [PROPERTY.emailStatus]: getEmailStatusPayload(emailStatusType, "Not_Sent"),
  });

  await safeCreateRunLog(notion, {
    actionId,
    eventType: "GATE_PASS_ISSUED",
    details: `Gate Pass ID ${gatePassId} successfully generated and assigned.`,
  });

  const qrDataUrl = await QRCode.toDataURL(gatePassId, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
  });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
  const outDate = getDateForEmail(leave.outDate);
  const inDate = getDateForEmail(leave.inDate);
  const parentText =
    leave.parentDraft ||
    `Dear Parent,\n\n${leave.studentName || "Your student"} has requested hostel leave from ${outDate} to ${inDate} for ${leave.reason || "the stated reason"}.\n\nPlease contact the hostel office if you have any questions.`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: leave.parentEmail,
    subject: `Hostel leave request for ${leave.studentName || "your student"}`,
    text: parentText,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: leave.studentEmail,
    subject: `Your hostel gate pass: ${gatePassId}`,
    text: `Your hostel leave has been approved.\n\nGate Pass ID: ${gatePassId}\nLeave dates: ${outDate} to ${inDate}\nDestination: ${leave.destination || "Not specified"}`,
    attachments: [
      {
        filename: `${gatePassId}.png`,
        content: qrBase64,
        encoding: "base64",
        contentType: "image/png",
      },
    ],
  });

  await safeCreateRunLog(notion, {
    actionId,
    eventType: "PARENT_NOTIFIED",
    details: "Parent draft dispatched, QR code gate pass sent to student.",
  });

  await updateLeavePage(notion, leave.pageId, {
    // This is the idempotency lock: future polling will ignore the completed row.
    [PROPERTY.emailStatus]: getEmailStatusPayload(emailStatusType, "Sent"),
  });

  return { pageId: leave.pageId, gatePassId, status: "Sent" };
}

function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function unauthorizedResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  return processApprovedLeaves();
}

export async function POST(request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  return processApprovedLeaves();
}

async function processApprovedLeaves() {
  if (isProcessing) {
    return Response.json({ success: true, skipped: true, reason: "Already processing." });
  }

  isProcessing = true;

  try {
    // This function is safe to call repeatedly; the Notion filter and lock prevent spam.
    const notionApiKey = process.env.NOTION_API_KEY;
    const leaveDatabaseId = getDatabaseId();

    if (!notionApiKey || !leaveDatabaseId) {
      return Response.json(
        { error: "NOTION_API_KEY and NOTION_LEAVE_DATABASE_ID are required." },
        { status: 500 },
      );
    }

    const notion = new Client({ auth: notionApiKey });
    const { properties, dataSourceId } = await getDatabaseSchema(
      notion,
      leaveDatabaseId,
    );

    if (!properties[PROPERTY.gatePassId]) {
      throw new Error(
        `Notion property "${PROPERTY.gatePassId}" is missing from the leave database.`,
      );
    }

    const query = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: createFilter(properties),
      page_size: 50,
    });
    const results = [];

    const rejectedQuery = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: createRejectFilter(properties),
      page_size: 50,
    });

    for (const page of rejectedQuery.results) {
      try {
        await updateLeavePage(notion, page.id, {
          [PROPERTY.emailStatus]: getEmailStatusPayload(
            properties[PROPERTY.emailStatus].type,
            "Error",
          ),
        });
        await safeCreateRunLog(notion, {
          actionId: randomUUID(),
          eventType: "REJECT",
          details: "Warden rejected request; Email Status changed to Error.",
        });
        results.push({ pageId: page.id, status: "Error", reason: "Rejected" });
      } catch (error) {
        console.error("Failed to mark rejected leave:", {
          pageId: page.id,
          message: getErrorMessage(error),
        });
      }
    }

    if (query.results.length === 0) {
      await safeCreateRunLog(notion, {
        actionId: randomUUID(),
        eventType: "INBOUND_PARSE",
        details: `Idle worker run: no rows matched Status=${getApprovedStatus()} and Email Status=Not_Sent. Rejected rows checked: ${rejectedQuery.results.length}.`,
      });

      return Response.json({
        success: true,
        processed: results.length,
        results,
        message:
          results.length > 0
            ? "Rejected leave requests marked as Error."
            : "No pending approved leave requests.",
      });
    }

    const transporter = createTransporter();

    for (const page of query.results) {
      try {
        results.push(
          await processLeave({ notion, transporter, page, properties }),
        );
      } catch (error) {
        const message = getErrorMessage(error);
        console.error("Failed to process approved leave:", {
          pageId: page.id,
          message,
        });

        try {
          const emailStatusType = properties[PROPERTY.emailStatus].type;
          await updateLeavePage(notion, page.id, {
            [PROPERTY.emailStatus]: getEmailStatusPayload(
              emailStatusType,
              "Error",
            ),
          });
        } catch (updateError) {
          console.error("Failed to mark leave as error:", {
            pageId: page.id,
            message: getErrorMessage(updateError),
          });
        }

        results.push({ pageId: page.id, status: "Error", error: message });

        await safeCreateRunLog(notion, {
          actionId: randomUUID(),
          eventType: "INBOUND_PARSE",
          details: `Error: ${message}`,
          ok: false,
        });
      }
    }

    return Response.json({
      success: true,
      processed: results.length,
      results,
      approvedFound: query.results.length,
      rejectedFound: rejectedQuery.results.length,
      message:
        results.length === 0
          ? "No leave requests are currently approved and marked Not_Sent."
          : "Approved leave requests processed.",
    });
  } catch (error) {
    console.error("Cron processor failed:", getErrorMessage(error));
    return Response.json(
      { error: "Unable to process approved leave requests." },
      { status: 502 },
    );
  } finally {
    isProcessing = false;
  }
}
