import React from 'react';
import { Text, View } from 'react-native';
import type { ActiveWorkoutStyles } from './styles';
import type { workoutSummary } from './sessionQuality';

export default function WorkoutFinishSummary({ summary, styles, historyState }: {
  summary: ReturnType<typeof workoutSummary>;
  styles: ActiveWorkoutStyles;
  historyState: 'loading' | 'loaded' | 'unavailable';
}) {
  return <View style={styles.exerciseCard}>
    <Text style={styles.exerciseName}>Session summary</Text>
    <Text style={[styles.previousSetText, { marginTop: 12 }]}>{summary.exercises} exercises · {summary.sets} sets · {summary.volume.toLocaleString()} lb volume</Text>
    {summary.records.map((record, i) => <Text key={i} style={[styles.addSetText, { marginTop: 8 }]}>Recent best: {record.name} · {record.weight} lb</Text>)}
    <Text style={[styles.previousSetText, { marginTop: 8 }]}>
      {historyState === 'loaded' ? 'Recent bests compare the last 50 saved workouts.' : historyState === 'loading' ? 'Loading previous performance…' : 'Previous performance unavailable. Sets can still be logged.'}
    </Text>
  </View>;
}
