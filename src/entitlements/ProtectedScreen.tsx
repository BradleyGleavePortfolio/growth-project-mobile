import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useEntitlement } from './EntitlementProvider';

interface ProtectedScreenProps {
  children: React.ReactNode;
}

export function ProtectedScreen({ children }: ProtectedScreenProps) {
  const { entitlementActive, checking, openPlans } = useEntitlement();

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4A7C59" />
      </View>
    );
  }

  if (entitlementActive === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Choose a Plan</Text>
        <Text style={styles.body}>Select a coaching package to access this feature.</Text>
        <TouchableOpacity style={styles.button} onPress={openPlans}>
          <Text style={styles.buttonText}>View Plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF8F5',
    paddingHorizontal: 32,
  },
  title: {
    fontFamily: 'Cormorant Garamond',
    fontSize: 28,
    color: '#1A1A1A',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#6B6B6B',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#4A7C59',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    fontFamily: 'Inter',
    fontWeight: '600',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
