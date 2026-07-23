package model

type IOTData struct {
	ID         int64   `json:"id"`
	Status     *int64  `json:"Status"`
	StatusText *string `json:"Status_Text"`
	UID        string  `json:"Uid"`
	Box        *string `json:"Box"`
	Order      *string `json:"Order"`
	Count      *int64  `json:"Count"`
	Time       *string `json:"Time"`
	Hour       *int64  `json:"Hour"`
	Second     *int64  `json:"Second"`
	PauseTime  *string `json:"PauseTime"`
	SNMac      *string `json:"SN_mac"`
	KeyButton  *int64  `json:"Key_button"`
	IPAddress  *string `json:"Ip_address"`
	SSIDWiFi   *string `json:"SSID_wifi"`
	RefID      *int64  `json:"Ref_id"`
	CreatedAt  *string `json:"Created_At"`
}

type ListResult struct {
	Data       []IOTData `json:"data"`
	Total      int64     `json:"total"`
	Page       int       `json:"page"`
	Limit      int       `json:"limit"`
	TotalPages int64     `json:"total_pages"`
}

type BoxStatus struct {
	Box      string  `json:"box"`
	IP       string  `json:"ip"`
	SNMac    *string `json:"sn_mac"`
	UID      string  `json:"uid"`
	LastSeen *string `json:"last_seen"`
	Online   bool    `json:"online"`
}

type DataFingerprint struct {
	Count    int64
	MaxID    int64
	Checksum int64
}
