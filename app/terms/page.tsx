"use client";
import Header from "@/components/Header";
import React from "react";

export default function TermsAndConditions() {
  return (
    <div>
         <Header />
   
    <main className="max-w-4xl mx-auto px-6 py-16 text-gray-800">
       
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Terms & Conditions</h1>
      <p className="text-gray-600 mb-10">
        Welcome to <span className="font-semibold">BrefNews</span>. 
        By accessing or using our platform (the “Service”), you agree to comply with and be bound by the following 
        Terms and Conditions. Please read them carefully before using the Service.
      </p>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">1. Acceptance of Terms</h2>
          <p className="text-gray-600">
            By accessing or using BrefNews, you agree to these Terms & Conditions and our Privacy Policy. 
            If you do not agree with any part of these terms, please discontinue use of the Service immediately.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">2. Description of Service</h2>
          <p className="text-gray-600">
            BrefNews provides short, summarized news updates sourced from various public and verified sources. 
            The platform is intended for informational purposes only and should not be considered as professional 
            advice or an official news publication.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">3. User Responsibilities</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>You agree to use BrefNews only for lawful purposes.</li>
            <li>You will not misuse or attempt to disrupt the Service in any way.</li>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>You agree not to reproduce, distribute, or modify any content without permission.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">4. Content Ownership</h2>
          <p className="text-gray-600">
            All content, trademarks, and design elements on BrefNews belong to BrefNews or its licensors.
            Third-party content and logos remain the property of their respective owners and are used under fair use 
            or partnership arrangements.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">5. Accuracy of Information</h2>
          <p className="text-gray-600">
            While we strive to provide accurate and up-to-date summaries, BrefNews does not guarantee 
            the completeness, accuracy, or timeliness of any information displayed. 
            Users are encouraged to visit the linked original sources for full details.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">6. Limitation of Liability</h2>
          <p className="text-gray-600">
            BrefNews and its team shall not be held liable for any damages, losses, or consequences arising 
            from the use or inability to use the Service, including but not limited to data loss, 
            system issues, or reliance on information presented.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">7. Third-Party Links</h2>
          <p className="text-gray-600">
            Our platform may include links to third-party websites or content. 
            These links are provided for convenience and do not imply endorsement or responsibility 
            for the content, accuracy, or policies of those external sites.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">8. Modifications to the Terms</h2>
          <p className="text-gray-600">
            BrefNews reserves the right to modify or update these Terms at any time. 
            Any changes will be effective immediately upon posting on this page. 
            Continued use of the Service after such changes constitutes your acceptance of the revised terms.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">9. Termination</h2>
          <p className="text-gray-600">
            We reserve the right to suspend or terminate your access to BrefNews at our discretion, 
            without prior notice, if you violate these Terms or engage in any activity that harms 
            the Service or other users.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">10. Contact Information</h2>
          <p className="text-gray-600">
            If you have any questions or concerns about these Terms & Conditions, 
            please contact us at: <br />
            <a href="mailto:support@brefnews.com" className="text-blue-600 hover:underline">
              support@brefnews.com
            </a>
          </p>
        </div>
      </section>

      <p className="text-sm text-gray-500 mt-10">
        Last updated: {new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
      </p>
    </main>
     </div>
  );
}
