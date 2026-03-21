/**
 * Debug script to decode and inspect a JWT token
 * Run with: npx ts-node debug-token.ts <your-token>
 */

const token = process.argv[2];

if (!token) {
  console.error('Usage: npx ts-node debug-token.ts <your-jwt-token>');
  process.exit(1);
}

try {
  // JWT tokens have 3 parts: header.payload.signature
  const parts = token.split('.');

  if (parts.length !== 3) {
    console.error('❌ Invalid JWT format. Expected 3 parts separated by dots.');
    process.exit(1);
  }

  // Decode the payload (second part)
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));

  console.log('\n📋 JWT Token Payload:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(JSON.stringify(payload, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n🔑 Extracted Roles:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check realm roles
  if (payload.realm_access?.roles) {
    console.log('Realm Roles:', payload.realm_access.roles);
  } else {
    console.log('Realm Roles: None');
  }

  // Check resource/client roles
  if (payload.resource_access) {
    console.log('\nClient Roles:');
    Object.entries(payload.resource_access).forEach(([client, data]: [string, any]) => {
      console.log(`  ${client}:`, data.roles);
    });
  } else {
    console.log('\nClient Roles: None');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check if admin role exists
  const hasAdminInRealm = payload.realm_access?.roles?.includes('perfana-admin') ||
                          payload.realm_access?.roles?.includes('admin');

  let hasAdminInClient = false;
  if (payload.resource_access) {
    hasAdminInClient = Object.values(payload.resource_access).some((data: any) =>
      data.roles?.includes('perfana-admin') || data.roles?.includes('admin')
    );
  }

  console.log('\n✅ Admin Check:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Has 'perfana-admin' or 'admin' in realm roles: ${hasAdminInRealm ? '✅ YES' : '❌ NO'}`);
  console.log(`Has 'perfana-admin' or 'admin' in client roles: ${hasAdminInClient ? '✅ YES' : '❌ NO'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!hasAdminInRealm && !hasAdminInClient) {
    console.log('\n⚠️  No admin role found!');
    console.log('\n📝 To fix this:');
    console.log('1. Go to Keycloak Admin Console');
    console.log('2. Select your realm → Users → Find your user');
    console.log('3. Go to Role Mappings tab');
    console.log('4. Assign role "perfana-admin" or "admin"');
    console.log('5. **LOG OUT and LOG BACK IN** to get a new token with the role');
  } else {
    console.log('\n✅ Admin role found! Token should work for admin endpoints.');
  }

  // Check expiration
  if (payload.exp) {
    const expiryDate = new Date(payload.exp * 1000);
    const now = new Date();
    const isExpired = expiryDate < now;

    console.log(`\n⏰ Token Expiry: ${expiryDate.toISOString()}`);
    console.log(`   Status: ${isExpired ? '❌ EXPIRED' : '✅ Valid'}`);
    if (isExpired) {
      console.log('   ⚠️  Token has expired. Please log in again.');
    }
  }

} catch (error) {
  console.error('❌ Error decoding token:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
