import { Upload } from 'antd'
import type { UploadProps } from 'antd'
import { HiOutlineDocumentArrowUp } from 'react-icons/hi2'

const { Dragger } = Upload

type UploadPanelProps = {
  title: string
  hint: string
  uploadProps: UploadProps
}

function UploadPanel({ title, hint, uploadProps }: UploadPanelProps) {
  return (
    <section className="upload-panel">
      <header className="upload-panel__header">
        <h3>{title}</h3>
        <p>{hint}</p>
      </header>

      <Dragger {...uploadProps} className="upload-panel__dropzone">
        <p className="ant-upload-drag-icon">
          <HiOutlineDocumentArrowUp aria-hidden="true" />
        </p>
        <p className="ant-upload-text">Click or drag a PDF file into this area</p>
        <p className="ant-upload-hint">{hint}</p>
      </Dragger>
    </section>
  )
}

export default UploadPanel
