// JWT Token Debugger - Run in browser console to inspect Keycloak tokens
// This helps debug audience mismatches and other JWT issues

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));

    return { header, payload };
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

function inspectKeycloakToken() {
  try {
    // Get the current Keycloak token from multiple sources
    let token = null;

    // Try to get token from Keycloak instance
    if (window.keycloak && window.keycloak.token) {
      token = window.keycloak.token;
      console.log('🔗 Found token from window.keycloak');
    }

    // Fallback to localStorage
    if (!token) {
      token = localStorage.getItem('perfana_access_token');
      if (token) {
        console.log('🔗 Found token from localStorage');
      }
    }

    // Try to get from auth headers function if available
    if (!token && typeof getAuthHeaders === 'function') {
      const headers = getAuthHeaders();
      const authHeader = headers.Authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
        console.log('🔗 Found token from auth headers');
      }
    }

    if (!token) {
      console.log('❌ No Keycloak token found');
      console.log('💡 Try logging in first, or check if Keycloak is initialized');
      return;
    }

    console.log('🔍 Inspecting Keycloak JWT Token');
    console.log('=====================================');

    const decoded = decodeJWT(token);
    if (!decoded) return;

    console.log('📋 Header:', decoded.header);
    console.log('📋 Payload:', decoded.payload);

    console.log('\n🎯 Key Claims for Backend Validation:');
    console.log('- Issuer (iss):', decoded.payload.iss);
    console.log('- Audience (aud):', decoded.payload.aud);
    console.log('- Subject (sub):', decoded.payload.sub);
    console.log('- Expires (exp):', new Date(decoded.payload.exp * 1000));
    console.log('- Issued At (iat):', new Date(decoded.payload.iat * 1000));

    console.log('\n👤 User Claims:');
    console.log('- Email:', decoded.payload.email);
    console.log('- Preferred Username:', decoded.payload.preferred_username);
    console.log('- Given Name:', decoded.payload.given_name);
    console.log('- Family Name:', decoded.payload.family_name);

    console.log('\n🔐 Roles & Permissions:');
    console.log('- Realm Access:', decoded.payload.realm_access);
    console.log('- Resource Access:', decoded.payload.resource_access);

    // Check for expected backend audience
    const expectedAudience = 'account';
    const actualAudience = decoded.payload.aud;

    console.log('\n🔍 Audience Validation:');
    console.log('- Expected:', expectedAudience);
    console.log('- Actual:', actualAudience);

    if (Array.isArray(actualAudience)) {
      const hasExpectedAudience = actualAudience.includes(expectedAudience);
      console.log('- Match:', hasExpectedAudience ? '✅ YES' : '❌ NO');
      if (!hasExpectedAudience) {
        console.log('⚠️  ISSUE: Backend expects audience "perfana-api" but token has:', actualAudience);
      }
    } else {
      const matches = actualAudience === expectedAudience;
      console.log('- Match:', matches ? '✅ YES' : '❌ NO');
      if (!matches) {
        console.log('⚠️  ISSUE: Backend expects audience "perfana-api" but token has:', actualAudience);
      }
    }

    // Check issuer
    const expectedIssuer = 'http://localhost:8080/realms/perfana-prod';
    const actualIssuer = decoded.payload.iss;

    console.log('\n🏢 Issuer Validation:');
    console.log('- Expected:', expectedIssuer);
    console.log('- Actual:', actualIssuer);
    console.log('- Match:', actualIssuer === expectedIssuer ? '✅ YES' : '❌ NO');

    if (actualIssuer !== expectedIssuer) {
      console.log('⚠️  ISSUE: Issuer mismatch detected');
    }

    console.log('\n💡 Recommendation:');
    if (Array.isArray(actualAudience) && !actualAudience.includes(expectedAudience)) {
      console.log('- Update backend KEYCLOAK_AUDIENCE to one of:', actualAudience);
    } else if (!Array.isArray(actualAudience) && actualAudience !== expectedAudience) {
      console.log('- Update backend KEYCLOAK_AUDIENCE to:', actualAudience);
    }

    return decoded;

  } catch (error) {
    console.error('❌ Error inspecting token:', error);
  }
}

function testJWKSConnection() {
  // Use backend API proxy to avoid CORS issues
  const apiUrl = 'http://localhost:3001/api';
  const jwksUrl = `${apiUrl}/auth/jwks`;

  console.log('🔗 Testing JWKS Connection (via API proxy)');
  console.log('JWKS URL:', jwksUrl);

  // Include auth headers for API access
  const headers = {};
  const token = localStorage.getItem('perfana_access_token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  fetch(jwksUrl, { headers })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(jwks => {
      console.log('✅ JWKS Connection Successful');
      console.log('Keys available:', jwks.keys?.length || 0);
      console.log('JWKS:', jwks);
    })
    .catch(error => {
      console.error('❌ JWKS Connection Failed:', error);
      console.log('💡 Possible issues:');
      console.log('- Keycloak server not running');
      console.log('- Wrong realm name');
      console.log('- Network connectivity issues');
    });
}

// Auto-expose functions to global scope
window.inspectKeycloakToken = inspectKeycloakToken;
window.testJWKSConnection = testJWKSConnection;
window.decodeJWT = decodeJWT;

console.log('🔧 JWT Debugger loaded:');
console.log('- inspectKeycloakToken() - Analyze current Keycloak token');
console.log('- testJWKSConnection() - Test backend JWKS connectivity');
console.log('- decodeJWT(token) - Decode any JWT token');