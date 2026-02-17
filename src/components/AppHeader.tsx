import { Layout, Space, Badge, Tooltip, Dropdown } from 'antd'
import { FiRefreshCw, FiInfo } from 'react-icons/fi'
import AboutSection from './AboutSection'

const { Header } = Layout

type AppHeaderProps = {
  hasComparisonInputs: boolean
  onReset: () => void
}

function AppHeader({ hasComparisonInputs, onReset }: AppHeaderProps) {
  const aboutOverlay = (
    <div className="about-dropdown">
      <div className="about-dropdown__scroll">
        <AboutSection className="about-section--dropdown" />
      </div>
    </div>
  )

  return (
    <Header className="app-header">
      <div className="brand-group">
        <div className="brand-mark">coder.qa</div>
      </div>
      <div className="header-right">
        <div className="nav-links">
          <Dropdown
            trigger={['hover', 'click']}
            dropdownRender={() => aboutOverlay}
            placement="bottom"
          >
            <button type="button" className="nav-link">
              <FiInfo aria-hidden="true" />
              <span>About</span>
            </button>
          </Dropdown>
        </div>

        <Space size={16} align="center">
          <Badge
            status={hasComparisonInputs ? 'success' : 'default'}
            text={hasComparisonInputs ? 'Ready to compare' : 'Awaiting uploads'}
          />
          <Tooltip title="Clear uploaded files and results">
            <button type="button" className="ghost-action" onClick={onReset}>
              <FiRefreshCw aria-hidden="true" />
              <span>Reset Workspace</span>
            </button>
          </Tooltip>
        </Space>
      </div>
    </Header>
  )
}

export default AppHeader
