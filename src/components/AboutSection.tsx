import { RiShieldStarLine, RiFileList3Line, RiTeamLine } from 'react-icons/ri'

type AboutSectionProps = {
  className?: string
}

function AboutSection({ className }: AboutSectionProps) {
  const sectionClassName = className ? `about-section ${className}` : 'about-section'

  return (
    <section className={sectionClassName}>
      <div className="about-section__intro">
        <h2>Built For Trustworthy Enterprise Reviews</h2>
        <p>
          coder.qa keeps your intellectual property on the device while delivering audit-ready
          visibility into every revision. No uploads to third-party clouds, no model training on
          your documents.
        </p>
      </div>

      <div className="about-section__pillars">
        <div className="about-pillar">
          <RiShieldStarLine aria-hidden="true" className="about-pillar__icon" />
          <h3>Security Operations Ready</h3>
          <p>
            Runs entirely in-browser with isolated workers so sensitive specs stay under your SSO
            perimeter. Optional offline mode provides continuity for air-gapped environments.
          </p>
        </div>
        <div className="about-pillar">
          <RiFileList3Line aria-hidden="true" className="about-pillar__icon" />
          <h3>Governance &amp; Evidence</h3>
          <p>
            Exports detailed diff summaries that plug into existing QA sign-off flows. Each
            highlight links back to source text for defensible reviews and audit trails.
          </p>
        </div>
        <div className="about-pillar">
          <RiTeamLine aria-hidden="true" className="about-pillar__icon" />
          <h3>Scales With Teams</h3>
          <p>
            Supports multi-document review cadences with instant runbacks, making it simple for
            engineering and compliance teams to collaborate around regulated documentation.
          </p>
        </div>
      </div>
    </section>
  )
}

export default AboutSection
