import { Typography, Statistic, Space, Tag } from 'antd'
import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiSpeedUpLine,
  RiShieldCheckLine,
  RiFocus3Line,
  RiGitRepositoryLine,
} from 'react-icons/ri'
import type { DiffStats } from '../types/diff'

const { Title, Paragraph } = Typography

type HeroSectionProps = {
  diffStats: DiffStats
  hasComparisonInputs: boolean
  comparisonNote: string | null
}

function HeroSection({ diffStats, hasComparisonInputs, comparisonNote }: HeroSectionProps) {
  const processingMode = comparisonNote
    ? 'Adaptive'
    : hasComparisonInputs
    ? 'Word'
    : 'Idle'
  const processingColor = comparisonNote ? '#faad14' : '#52c41a'

  return (
    <section className="page-hero">
      <Title level={1} className="page-title">Document Comparison</Title>
      <Paragraph className="page-subtitle">
        Validate revisions faster with automated drift detection, page-level overlays, and QA-ready reporting tailored for engineering and documentation teams.
      </Paragraph>
      <div className="hero-highlights">
        <Statistic
          title="Added Tokens"
          value={diffStats.added}
          suffix="words"
          prefix={<RiArrowUpLine aria-hidden="true" />}
          valueStyle={{ color: diffStats.added > 0 ? '#1677ff' : '#8c8c8c' }}
        />
        <Statistic
          title="Removed Tokens"
          value={diffStats.removed}
          suffix="words"
          prefix={<RiArrowDownLine aria-hidden="true" />}
          valueStyle={{ color: diffStats.removed > 0 ? '#ff4d4f' : '#8c8c8c' }}
        />
        <Statistic
          title="Processing Mode"
          value={processingMode}
          prefix={<RiSpeedUpLine aria-hidden="true" />}
          valueStyle={{ color: processingColor }}
        />
      </div>
      <Space size={24} wrap>
        <Tag color="blue" icon={<RiShieldCheckLine aria-hidden="true" />}>
          Secure local parsing
        </Tag>
        <Tag color="geekblue" icon={<RiFocus3Line aria-hidden="true" />}>
          QA-focused diff overlays
        </Tag>
        <Tag color="purple" icon={<RiGitRepositoryLine aria-hidden="true" />}>
          Adaptive precision modes
        </Tag>
      </Space>
    </section>
  )
}

export default HeroSection
