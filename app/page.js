"use client";

import { useState } from "react";

export default function Home() {
  const [request, setRequest] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/leave-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to submit your request.");
      }

      setMessage(
        "Your leave request was submitted and is waiting for warden approval.",
      );
      setRequest("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eeeafd] px-4 py-10 text-[#554766] sm:px-6">
      <section className="w-full max-w-2xl rounded-3xl border border-[#faf8ff] bg-[#e4ddf7] p-6 shadow-[18px_18px_40px_rgba(139,121,169,0.28),-14px_-14px_34px_rgba(255,255,255,0.9),inset_3px_3px_8px_rgba(255,255,255,0.65),inset_-5px_-5px_12px_rgba(145,124,176,0.16)] sm:p-10">
        <div className="mb-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-[#967eb0]">
            Student Services
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-[#69547f] sm:text-5xl">
            Hostel Leave Form
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[#806f8d] sm:text-base">
            Share your leave details below and we will prepare your request.
          </p>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="leave-request">
            Leave request
          </label>
          <textarea
            id="leave-request"
            name="request"
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Write your reason, dates, and any other details..."
            required
            maxLength={5000}
            rows={12}
            className="w-full resize-y rounded-2xl border border-[#f4cdb8] bg-[#ffe1cd] px-5 py-4 text-base leading-7 text-[#654c50] shadow-[inset_5px_5px_12px_rgba(190,133,108,0.2),inset_-5px_-5px_12px_rgba(255,255,255,0.72)] outline-none transition duration-200 placeholder:text-[#ae8780] focus:border-[#e6a98f] focus:shadow-[inset_5px_5px_12px_rgba(190,133,108,0.2),inset_-5px_-5px_12px_rgba(255,255,255,0.72),0_0_0_5px_rgba(238,178,147,0.3)]"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 rounded-2xl border border-[#96d2b5] bg-[#a9dfc4] px-7 py-3.5 font-bold text-[#356254] shadow-[7px_7px_14px_rgba(103,158,130,0.3),-5px_-5px_12px_rgba(255,255,255,0.72),inset_2px_2px_4px_rgba(255,255,255,0.48),inset_-3px_-3px_5px_rgba(79,144,111,0.18)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#b6e8cf] hover:shadow-[9px_9px_17px_rgba(103,158,130,0.3),-5px_-5px_12px_rgba(255,255,255,0.72)] active:translate-y-1 active:shadow-[inset_4px_4px_8px_rgba(79,144,111,0.2),inset_-3px_-3px_5px_rgba(255,255,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </button>
          {message && (
            <p className="mt-5 rounded-xl bg-[#f7cdb9] px-4 py-3 text-sm text-[#76545b] shadow-[inset_2px_2px_5px_rgba(190,133,108,0.12)]">
              {message}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
