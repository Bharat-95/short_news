"use client";
import Header from "@/components/Header";
import React from "react";

export default function PrivacyPolicy() {
  return (
    <div>
        <Header />
    <main className="max-w-4xl mx-auto px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
      <p className="text-gray-600 mb-10">
        This Privacy Policy describes how <span className="font-semibold">BrefNews</span> 
        (“we,” “our,” or “us”) collects, uses, and protects your information when you 
        use our website or mobile application (“Service”).
      </p>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">1. Information We Collect</h2>
          <p className="text-gray-600">
            We collect different types of information to provide and improve our services:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 mt-2">
            <li>
              <strong>Personal Information:</strong> Such as your name, email address, or
              preferences when you sign up or contact us.
            </li>
            <li>
              <strong>Usage Data:</strong> Information about how you access and use BrefNews,
              including device type, browser, pages visited, and session duration.
            </li>
            <li>
              <strong>Cookies & Analytics:</strong> We use cookies and analytics tools to
              understand user behavior and improve our platform experience.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">2. How We Use Your Information</h2>
          <p className="text-gray-600">
            BrefNews uses collected data to:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 mt-2">
            <li>Provide, personalize, and maintain your user experience.</li>
            <li>Analyze trends and improve our content delivery.</li>
            <li>Send relevant notifications or updates (if you’ve opted in).</li>
            <li>Detect, prevent, and address technical or security issues.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">3. Data Storage and Security</h2>
          <p className="text-gray-600">
            We implement industry-standard security measures to protect your personal data 
            from unauthorized access, alteration, disclosure, or destruction. However, please note 
            that no online platform can guarantee absolute security.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">4. Cookies and Tracking Technologies</h2>
          <p className="text-gray-600">
            We use cookies to remember your preferences and to improve your browsing experience.
            You can choose to disable cookies through your browser settings, but some parts of 
            BrefNews may not function properly without them.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">5. Third-Party Services</h2>
          <p className="text-gray-600">
            BrefNews may use third-party tools (like analytics or ad networks) that collect,
            monitor, and analyze user data under their own privacy policies. We do not share 
            your personal information without your consent except as required by law.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">6. Your Data Rights</h2>
          <p className="text-gray-600">
            You have the right to:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 mt-2">
            <li>Access, correct, or delete your personal data.</li>
            <li>Opt out of promotional emails or notifications.</li>
            <li>Withdraw consent for data processing at any time.</li>
          </ul>
          <p className="text-gray-600 mt-2">
            To exercise your rights, contact us using the email below.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">7. Children’s Privacy</h2>
          <p className="text-gray-600">
            BrefNews is not intended for users under the age of 13. We do not knowingly collect
            personal information from minors. If you believe a child has provided data, please 
            contact us for immediate removal.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">8. Updates to This Policy</h2>
          <p className="text-gray-600">
            We may update this Privacy Policy periodically to reflect changes in technology, 
            law, or our practices. Updates will be posted on this page, and the date below 
            will be revised accordingly.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">9. Contact Us</h2>
          <p className="text-gray-600">
            If you have any questions or requests related to this Privacy Policy, please contact:
            <br />
            <a
              href="mailto:privacy@brefnews.com"
              className="text-blue-600 hover:underline"
            >
              privacy@brefnews.com
            </a>
          </p>
        </div>
      </section>

      <p className="text-sm text-gray-500 mt-10">
        Last updated:{" "}
        {new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
      </p>
    </main>
    </div>
  );
}
