// Matrix Rail — Go quickstart.
//
// The rail is local-first gRPC (127.0.0.1). Any gRPC-speaking language that has
// the mneme.proto contract reaches EVERY Mneme tool. This shows Health, a unary
// Invoke, and the ContextStream delta channel.
//
// Setup (once):
//
//	go mod init mneme-matrix-quickstart
//	go get google.golang.org/grpc google.golang.org/protobuf
//	# generate stubs from ../proto/mneme.proto with protoc-gen-go + protoc-gen-go-grpc:
//	protoc -I../proto --go_out=. --go-grpc_out=. ../proto/mneme.proto
//
// Run the rail:  mneme matrix serve --port 50777
// Then:          go run client.go 127.0.0.1:50777
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	pb "mneme-matrix-quickstart/mneme" // generated package
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	addr := "127.0.0.1:50777"
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	c := pb.NewMatrixClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 1) Health
	h, _ := c.Health(ctx, &pb.HealthRequest{})
	fmt.Printf("health: ok=%v version=%s tools=%d trustless=%v\n", h.Ok, h.Version, h.Tools, h.Trustless)

	// 2) Invoke — the typed door; reply carries an Ed25519 proof in ProofJson.
	args, _ := json.Marshal(map[string]string{"claim": "2 + 2 = 4"})
	r, _ := c.Invoke(ctx, &pb.ToolRequest{Tool: "mneme.savant.verify", ArgsJson: string(args)})
	fmt.Printf("invoke ok=%v wisdom=%.80s\n", r.Ok, r.Wisdom)

	// 3) ContextStream — the delta channel (open with a snapshot, stream splice ops).
	base := ""
	for i := 0; i < 200; i++ {
		base += "const a = 1;\n"
	}
	stream, _ := c.ContextStream(ctx)
	go func() {
		stream.Send(&pb.DeltaMsg{ChannelId: "c1", Snapshot: true, Base: base})
		for i := 0; i < 10; i++ {
			op, _ := json.Marshal(map[string]any{"at": (i * 17) % len(base), "del": i % 2, "ins": fmt.Sprintf("/*%d*/", i)})
			stream.Send(&pb.DeltaMsg{ChannelId: "c1", Snapshot: false, OpJson: string(op)})
		}
		stream.CloseSend()
	}()
	for {
		ack, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			panic(err)
		}
		if ack.DocHash != "" {
			fmt.Printf("  delta ack: %dB sent, doc now %d chars, hash %.12s…\n", ack.DeltaBytes, ack.DocLen, ack.DocHash)
		}
	}
}
