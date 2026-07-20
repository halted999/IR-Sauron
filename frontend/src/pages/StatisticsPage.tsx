import React from 'react'
import { AppLayout } from '../components/Layout/AppLayout'

export const StatisticsPage: React.FC = () => {
  return (
    <AppLayout>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 56px)',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
            Статистика
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Раздел в разработке
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
