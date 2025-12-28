'use client';

import { useEffect, useState } from 'react';
import { Template } from '@/types/template';
import { templateService } from '@/services/templateService';
import TemplateList from '@/components/TemplateList';
import TemplateForm from '@/components/TemplateForm';

export default function Home() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await templateService.getAll();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (template: Omit<Template, 'id'>) => {
    try {
      await templateService.create(template);
      await loadTemplates();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create template');
    }
  };

  const handleUpdate = async (template: Omit<Template, 'id'>) => {
    if (!editingTemplate) return;
    try {
      await templateService.update(editingTemplate.id, { ...template, id: editingTemplate.id });
      await loadTemplates();
      setEditingTemplate(null);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      await templateService.delete(id);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingTemplate(null);
  };

  const handleNewTemplate = () => {
    setEditingTemplate(null);
    setShowForm(true);
  };

  return (
    <div className="container">
      <header className="header">
        <h1>CheckMate - Template Manager</h1>
      </header>

      <main className="main-content">
        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={() => setError(null)} className="btn btn-small">Dismiss</button>
          </div>
        )}

        {!showForm && (
          <div className="toolbar">
            <button onClick={handleNewTemplate} className="btn btn-primary">
              Create New Template
            </button>
          </div>
        )}

        {showForm ? (
          <div className="form-container">
            <h2>{editingTemplate ? 'Edit Template' : 'Create New Template'}</h2>
            <TemplateForm
              template={editingTemplate || undefined}
              onSubmit={editingTemplate ? handleUpdate : handleCreate}
              onCancel={handleCancel}
            />
          </div>
        ) : loading ? (
          <p className="loading-message">Loading templates...</p>
        ) : (
          <TemplateList
            templates={templates}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </main>
    </div>
  );
}
