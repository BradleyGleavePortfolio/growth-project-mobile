import React, { useEffect, useState } from 'react';
import { Text, type TextProps } from 'react-native';
import { exerciseLibraryApi } from '../../../api/exerciseLibraryApi';

/** Resolve server-loaded ids without changing the builder's working copy or wire payload. */
export default function CoachExerciseName({ id, fallback, prefix, style }: {
  id: string; fallback: string; prefix: string; style: TextProps['style'];
}) {
  const [resolved, setResolved] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (fallback !== id) return; // A freshly chosen exercise already has its name.
    let mounted = true;
    exerciseLibraryApi.getById(id).then(({ data }) => {
      if (mounted && data.name) setResolved({ id, name: data.name });
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, [id, fallback]);
  return <Text style={style}>{prefix}{resolved?.id === id ? resolved.name : fallback}</Text>;
}
