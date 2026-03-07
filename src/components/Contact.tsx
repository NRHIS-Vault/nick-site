import React, { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ApiError,
  ContactRequest,
  submitContactForm,
} from "@/lib/api";

// Reusable email matcher kept lightweight for client-side validation.
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Partial<Record<keyof ContactRequest, string>>;

const Contact: React.FC = () => {
  const [form, setForm] = useState<ContactRequest>({
    name: "",
    email: "",
    message: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "";
    message: string;
  }>({ type: "", message: "" });

  // Validate inputs before hitting the network.
  const validate = useMemo(
    () => (values: ContactRequest): FieldErrors => {
      const next: FieldErrors = {};

      if (!values.name.trim()) {
        next.name = "Please enter your name.";
      }
      if (!values.email.trim()) {
        next.email = "Email is required.";
      } else if (!emailPattern.test(values.email.trim())) {
        next.email = "Enter a valid email address.";
      }
      if (!values.message.trim()) {
        next.message = "Message is required.";
      }

      return next;
    },
    []
  );

  const contactMutation = useMutation({
    mutationFn: submitContactForm,
    onSuccess: (response) => {
      setFeedback({
        type: "success",
        message:
          response.message ??
          "Message received. We'll get back to you shortly.",
      });
      setErrors({});
      setForm({ name: "", email: "", message: "" });
    },
    onError: (error: ApiError) => {
      setFeedback({
        type: "error",
        message:
          error.message ||
          "We could not send your message. Please try again.",
      });
    },
  });

  const handleChange =
    (field: keyof ContactRequest) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      // Clear the specific field error as soon as the user edits the field.
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback({ type: "", message: "" });

    const validation = validate(form);
    setErrors(validation);

    if (Object.values(validation).some(Boolean)) {
      setFeedback({
        type: "error",
        message: "Please fix the highlighted fields and try again.",
      });
      return;
    }

    contactMutation.mutate(form);
  };

  const isSubmitting = contactMutation.isPending;

  return (
    <section id="contact" className="py-20 bg-surface text-foreground">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Get Started Today</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Ready to transform your business with AI? Connect with RHNIS and
            discover the possibilities.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12">
          <div>
            <h3 className="text-2xl font-bold mb-6">Contact Information</h3>
            <div className="space-y-4">
              <div className="flex items-center">
                <svg
                  className="w-6 h-6 mr-4 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <span>contact@nick-ai.link</span>
              </div>
              <div className="flex items-center">
                <svg
                  className="w-6 h-6 mr-4 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9"
                  />
                </svg>
                <span>nick-ai.link</span>
              </div>
            </div>

            <div className="mt-8">
              <h4 className="text-lg font-semibold mb-4">Quick Access</h4>
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="https://dashboard.nick-ai.link"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg transition-colors text-center"
                >
                  Access Dashboard
                </a>
                <button className="border border-border text-foreground hover:bg-foreground hover:text-background px-6 py-3 rounded-lg transition-colors">
                  Schedule Demo
                </button>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-8 rounded-2xl shadow-lg">
            <h3 className="text-2xl font-bold mb-6">Send a Message</h3>

            {feedback.message && (
              <div
                className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                  feedback.type === "success"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                    : "border-destructive/50 bg-destructive/10 text-destructive"
                }`}
              >
                {feedback.message}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div>
                <label className="sr-only" htmlFor="contact-name">
                  Name
                </label>
                <input
                  id="contact-name"
                  type="text"
                  placeholder="Your Name"
                  value={form.name}
                  onChange={handleChange("name")}
                  className={`w-full px-4 py-3 bg-surface-muted border rounded-lg focus:outline-none focus:ring-2 ${
                    errors.name ? "border-destructive" : "border-border"
                  } focus:ring-primary`}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "contact-name-error" : undefined}
                />
                {errors.name && (
                  <p
                    id="contact-name-error"
                    className="mt-1 text-sm text-destructive"
                  >
                    {errors.name}
                  </p>
                )}
              </div>

              <div>
                <label className="sr-only" htmlFor="contact-email">
                  Email
                </label>
                <input
                  id="contact-email"
                  type="email"
                  placeholder="Your Email"
                  value={form.email}
                  onChange={handleChange("email")}
                  className={`w-full px-4 py-3 bg-surface-muted border rounded-lg focus:outline-none focus:ring-2 ${
                    errors.email ? "border-destructive" : "border-border"
                  } focus:ring-primary`}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={
                    errors.email ? "contact-email-error" : undefined
                  }
                />
                {errors.email && (
                  <p
                    id="contact-email-error"
                    className="mt-1 text-sm text-destructive"
                  >
                    {errors.email}
                  </p>
                )}
              </div>

              <div>
                <label className="sr-only" htmlFor="contact-message">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  placeholder="Your Message"
                  rows={4}
                  value={form.message}
                  onChange={handleChange("message")}
                  className={`w-full px-4 py-3 bg-surface-muted border rounded-lg focus:outline-none focus:ring-2 ${
                    errors.message ? "border-destructive" : "border-border"
                  } focus:ring-primary`}
                  aria-invalid={Boolean(errors.message)}
                  aria-describedby={
                    errors.message ? "contact-message-error" : undefined
                  }
                ></textarea>
                {errors.message && (
                  <p
                    id="contact-message-error"
                    className="mt-1 text-sm text-destructive"
                  >
                    {errors.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground py-3 rounded-lg transition-colors"
              >
                {isSubmitting ? "Sending..." : "Send Message"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
