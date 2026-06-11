import { ToolSection } from "@/components/ToolSection";
import { Shield, Zap, Lock, Image as ImageIcon, Search, FileX, Tag, SearchCheck, CheckCircle2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const CARD_STYLE = {
  background: "#ffffff",
  border: "1px solid #f3e8ff",
  boxShadow: "0 2px 16px rgba(124, 58, 237, 0.08)",
};

const SECTION_ALT_BG = { backgroundColor: "#fafafa" };
const SECTION_WHITE_BG = { backgroundColor: "#ffffff" };

export default function Home() {
  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: "#ffffff", color: "#0f0f0f" }}>

      {/* Navbar */}
      <header
        className="sticky top-0 z-20"
        style={{
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid #f3e8ff",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#7c3aed" }}>
              <Tag className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight" style={{ color: "#0f0f0f" }}>RemoveTag</span>
          </div>
          <div className="flex items-center">
            <span
              className="rt-badge-free text-white text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide"
              style={{ backgroundColor: "#7c3aed" }}
            >
              Free Tool
            </span>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section style={{ background: "linear-gradient(135deg, #fdf4ff 0%, #eff6ff 100%)" }}>
          <div className="pt-20 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
            <div className="rt-hero-heading flex justify-center mb-5">
            <span
              className="rt-badge-free inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ backgroundColor: "#f3e8ff", color: "#7c3aed" }}
            >
              ✦ Free &amp; Private — No Upload to Server
            </span>
          </div>
          <h1
            className="rt-hero-heading tracking-tight mb-6"
            style={{ color: "#0f0f0f", fontSize: "clamp(32px, 12.8vw, 64px)", fontWeight: 800, lineHeight: 1.1 }}
          >
            Remove AI Labels Before You Post
          </h1>
            <p
              className="rt-hero-subtext text-lg sm:text-xl max-w-2xl mx-auto mb-12"
              style={{ color: "#6b7280" }}
            >
              Strip C2PA, XMP &amp; EXIF metadata instantly. Browser-only. Free forever.
            </p>
            <ToolSection />
          </div>

          {/* Wave divider → How it works */}
          <div className="w-full overflow-hidden leading-none" style={{ marginBottom: "-1px" }}>
            <svg viewBox="0 0 1440 60" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" className="w-full block" style={{ height: "60px" }}>
              <path d="M0,30 C360,60 720,0 1080,30 C1260,45 1380,20 1440,30 L1440,60 L0,60 Z" fill="#f5f3ff" />
            </svg>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 px-4 sm:px-6 lg:px-8" style={SECTION_ALT_BG}>
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4" style={{ color: "#0f0f0f" }}>How it works</h2>
              <p style={{ color: "#6b7280" }} className="max-w-2xl mx-auto">
                100% private, client-side metadata stripping in three simple steps.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                { icon: <ImageIcon className="w-7 h-7" style={{ color: "#7c3aed" }} />, title: "1. Select Images", body: "Drag and drop or select your photos. We support JPG, PNG, and WebP up to 15MB each." },
                { icon: <Zap className="w-7 h-7" style={{ color: "#7c3aed" }} />, title: "2. Choose Data", body: "Select which metadata to remove. EXIF, XMP, C2PA, and hidden text chunks are all supported." },
                { icon: <Lock className="w-7 h-7" style={{ color: "#7c3aed" }} />, title: "3. Private Clean", body: "Your files are processed directly in your browser. They are never uploaded to any server." },
              ].map(({ icon, title, body }) => (
                <div key={title} className="rt-card p-8 rounded-2xl text-center" style={CARD_STYLE}>
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: "rgba(124,58,237,0.08)" }}>
                    {icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-3" style={{ color: "#0f0f0f" }}>{title}</h3>
                  <p style={{ color: "#6b7280" }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What we remove */}
        <section className="py-20 px-4 sm:px-6 lg:px-8" style={SECTION_WHITE_BG}>
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4" style={{ color: "#0f0f0f" }}>What we remove</h2>
              <p style={{ color: "#6b7280" }} className="max-w-2xl mx-auto">
                We strip hidden data that social networks use to identify hardware or AI generation.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: <Search className="w-8 h-8 mb-4" style={{ color: "#7c3aed" }} />, title: "EXIF Data", body: "Camera model, lens, exposure settings, GPS location, and timestamp data." },
                { icon: <FileX className="w-8 h-8 mb-4" style={{ color: "#7c3aed" }} />, title: "XMP Data", body: "Adobe's Extensible Metadata Platform often containing edit history and AI tags." },
                { icon: <Shield className="w-8 h-8 mb-4" style={{ color: "#7c3aed" }} />, title: "C2PA / CR", body: "Content Credentials used by AI tools (Midjourney, DALL-E) to label images as AI generated." },
                { icon: <SearchCheck className="w-8 h-8 mb-4" style={{ color: "#7c3aed" }} />, title: "PNG Chunks", body: "Hidden text chunks (tEXt, zTXt, iTXt) often containing AI prompts or generation parameters." },
              ].map(({ icon, title, body }) => (
                <div key={title} className="rt-card p-6 rounded-xl" style={CARD_STYLE}>
                  {icon}
                  <h4 className="font-semibold text-lg mb-2" style={{ color: "#0f0f0f" }}>{title}</h4>
                  <p className="text-sm" style={{ color: "#6b7280" }}>{body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Wave divider → FAQ */}
          <div className="w-full overflow-hidden leading-none mt-20" style={{ marginBottom: "-1px" }}>
            <svg viewBox="0 0 1440 60" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" className="w-full block" style={{ height: "60px" }}>
              <path d="M0,20 C480,60 960,0 1440,30 L1440,60 L0,60 Z" fill="#fafafa" />
            </svg>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-4 sm:px-6 lg:px-8" style={SECTION_ALT_BG}>
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4" style={{ color: "#0f0f0f" }}>Frequently Asked Questions</h2>
            </div>

            <Accordion type="single" collapsible className="w-full rounded-2xl p-6" style={CARD_STYLE}>
              {[
                { q: "Are my photos uploaded to a server?", a: "No. RemoveTag operates entirely inside your web browser. When you select an image, all reading and stripping of metadata happens locally on your device using JavaScript. Your files never leave your computer, ensuring complete privacy." },
                { q: "What is C2PA and AI labeling?", a: 'C2PA (Coalition for Content Provenance and Authenticity) is an open standard that allows creators (including AI generators) to attach tamper-evident metadata to digital content. Many platforms like Instagram and TikTok read this data to automatically apply "AI Generated" labels to your posts. Stripping this metadata removes the hidden markers.' },
                { q: "Does this reduce image quality?", a: "For most images, we surgically remove only the metadata chunks (like EXIF or XMP data) leaving the original pixel data untouched. In cases where surgical removal is complex, we re-encode the image via your browser's native canvas at 95% quality to guarantee the metadata is gone, which is virtually indistinguishable from the original." },
                { q: "What file formats are supported?", a: "We currently support JPG/JPEG, PNG, and WebP images. These are the most common formats used across social media and web platforms." },
                { q: "What are the file limits?", a: "You can process up to 20 files at once, with each file up to 15MB in size. These limits ensure the tool runs smoothly and quickly directly in your browser without causing memory issues." },
                { q: "Is this tool really free?", a: "Yes, RemoveTag is 100% free. Since all the processing happens on your device rather than our servers, our running costs are extremely low, allowing us to provide this privacy utility at no cost." },
              ].map(({ q, a }, i) => (
                <AccordionItem key={i} value={`item-${i + 1}`}>
                  <AccordionTrigger className="text-left font-medium" style={{ color: "#0f0f0f" }}>{q}</AccordionTrigger>
                  <AccordionContent style={{ color: "#6b7280" }} className="leading-relaxed">{a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8" style={{ backgroundColor: "#ffffff", borderTop: "1px solid #f3e8ff" }}>
        <div className="max-w-7xl mx-auto flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5" style={{ color: "#7c3aed" }} />
            <span className="font-bold text-xl" style={{ color: "#0f0f0f" }}>RemoveTag</span>
          </div>
          <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1 rounded-full text-sm font-medium mb-6">
            <CheckCircle2 className="w-4 h-4" /> Your files never leave your browser
          </div>
          <p className="text-sm max-w-2xl" style={{ color: "#6b7280" }}>
            RemoveTag is a client-side utility designed to protect your privacy. While we strive to remove all known metadata and AI markers, platforms continuously update their detection methods. We do not store, view, or process your files on any server.
          </p>
          <div className="mt-8 text-sm" style={{ color: "#6b7280", opacity: 0.7 }}>
            &copy; {new Date().getFullYear()} RemoveTag. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
