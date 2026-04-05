export interface User {
    id: string;
    name: string;
}

export interface UserRepository {
    getUser(id: string): Promise<User | null>;
    saveUser(user: User): Promise<void>;
}

// DynamoDB implementation (stub)
class DynamoUserRepository implements UserRepository {
    async getUser(id: string): Promise<User | null> {
        // Here you would use DynamoDB client to fetch data
        return { id, name: "Stub User" };
    }
    
    async saveUser(user: User): Promise<void> {
        // Here you would use DynamoDB client to save data
        console.log(`Saved user: ${user.id}`);
    }
}

export function getUserRepository(): UserRepository {
    return new DynamoUserRepository();
}
