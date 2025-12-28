'use client';

import { Template } from '@/types/template';
import { useState } from 'react';

interface TemplateFormProps {
  template?: Template;
  onSubmit: (template: Omit<Template, 'id'>) => Promise<void>;
  onCancel: () => void;
}

export default function TemplateForm({ template, onSubmit, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(template?.name || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({ name });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="template-form">
      <div className="form-group">
        <label htmlFor="name">Template Name:</label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={isSubmitting}
          className="form-input"
        />
      </div>
      <div className="form-actions">
        <button type="submit" disabled={isSubmitting} className="btn btn-primary">
          {isSubmitting ? 'Saving...' : template ? 'Update' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
